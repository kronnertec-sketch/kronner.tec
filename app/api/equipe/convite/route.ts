import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseEnv, resolvePublicOrigin } from '@/lib/server-origin';

export const dynamic = 'force-dynamic';

const InviteSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do profissional (2 a 100 caracteres).').max(100),
  email: z.string().trim().email('Informe um e-mail válido.').max(254),
  role: z.enum(['partner', 'employee'], { message: 'Papel inválido.' }),
  finance: z.boolean().optional(),
  commission_enabled: z.boolean().optional(),
  commission_bps: z.number().int().min(0).max(10000).optional(),
  can_manage_memberships: z.boolean().optional(),
  can_register_payment: z.boolean().optional(),
  can_share_link: z.boolean().optional(),
});

const SAFE_RPC_ERRORS = new Set([
  'Entre na sua conta.',
  'Sem vínculo ativo com a equipe.',
  'Somente a conta principal gerencia a equipe.',
  'Somente o proprietário ou sócio gerencia a equipe.',
  'Confira nome, e-mail e papel.',
  'Limite de cadeiras do plano atingido. Adicione cadeiras na assinatura.',
  'Ative ou regularize sua assinatura para convidar profissionais.',
  'Limite diário de convites atingido. Tente novamente mais tarde.',
]);

// Bounded FIFO per-shop burst rate limit (after auth, max 1,000 keys)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const RATE_MAP_CAP = 1000;
const recentRequests = new Map<string, number[]>();

function isRateLimited(shopId: string): boolean {
  const now = Date.now();
  const timestamps = (recentRequests.get(shopId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    recentRequests.set(shopId, timestamps);
    return true;
  }
  timestamps.push(now);
  recentRequests.set(shopId, timestamps);
  while (recentRequests.size > RATE_MAP_CAP) {
    const oldestKey = recentRequests.keys().next().value;
    if (oldestKey === undefined) break;
    recentRequests.delete(oldestKey);
  }
  return false;
}

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return reply({ error: 'Entre na sua conta.' }, 401);
  }

  const origin = resolvePublicOrigin(request);
  if (!origin) {
    return reply({ error: 'Origem pública da aplicação não configurada.' }, 503);
  }

  const supabaseEnv = getSupabaseEnv();
  if (!supabaseEnv) {
    return reply({ error: 'Serviço de dados não configurado.' }, 503);
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    const firstMessage = parsed.error.issues[0]?.message || 'Confira nome, e-mail e papel.';
    return reply({ error: firstMessage }, 400);
  }

  const jwt = authorization.slice(7).trim();
  const db = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Authenticate & verify caller is Owner or Partner BEFORE updating the rate-limit Map
  const { data: identity, error: idError } = await db.rpc('kroner_team', {
    action: 'identity',
    payload: {},
  });
  if (idError) {
    return reply({ error: 'Não foi possível validar sua sessão.' }, 503);
  }
  const role = identity && typeof identity === 'object' ? (identity as { role?: unknown }).role : null;
  const shop = identity && typeof identity === 'object' ? (identity as { shop?: unknown }).shop : null;
  if (
    (role !== 'owner' && role !== 'partner') ||
    typeof shop !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(shop)
  ) {
    return reply({ error: 'Somente o proprietário ou sócio gerencia a equipe.' }, 403);
  }

  if (isRateLimited(shop)) {
    return reply({ error: 'Muitas tentativas de convite. Aguarde alguns minutos.' }, 429);
  }

  const { data, error } = await db.rpc('kroner_team', {
    action: 'invite',
    payload: parsed.data,
  });

  if (error) {
    const safeMessage = SAFE_RPC_ERRORS.has(error.message)
      ? error.message
      : 'Não foi possível criar o convite. Verifique os dados e tente novamente.';
    return reply({ error: safeMessage }, 400);
  }

  const url = new URL('/entrar', origin);
  url.searchParams.set('mode', 'signup');
  url.searchParams.set('next', '/equipe');

  let sent = false;
  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  if (clerkSecret) {
    try {
      const result = await fetch('https://api.clerk.com/v1/invitations', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + clerkSecret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: parsed.data.email,
          redirect_url: url.toString(),
          expires_in_days: 7,
          notify: true,
          ignore_existing: true,
        }),
        signal: AbortSignal.timeout(5000),
      });
      sent = result.ok;
    } catch {
      sent = false;
    }
  }

  return reply({ token: data?.token, sent }, 200);
}
