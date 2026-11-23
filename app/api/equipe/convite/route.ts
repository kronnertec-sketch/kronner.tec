import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getSupabaseEnv, resolvePublicOrigin } from '@/lib/server-origin';

export const dynamic = 'force-dynamic';

const InviteSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do profissional (2 a 100 caracteres).').max(100),
  email: z.string().trim().email('Informe um e-mail válido.').max(254),
  role: z.enum(['partner', 'employee'], { message: 'Papel inválido.' }),
});

const SAFE_RPC_ERRORS = new Set([
  'Entre na sua conta.',
  'Sem vínculo ativo com a equipe.',
  'Somente a conta principal gerencia a equipe.',
  'Confira nome, e-mail e papel.',
  'Limite de cadeiras do plano atingido. Adicione cadeiras na assinatura.',
  'Ative ou regularize sua assinatura para convidar profissionais.',
  'Limite diário de convites atingido. Tente novamente mais tarde.',
]);

// Burst rate limit por processo (complementa o limite persistente de 24h no Postgres)
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const recentRequests = new Map<string, number[]>();

function isRateLimited(token: string): boolean {
  const key = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const timestamps = (recentRequests.get(key) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) {
    recentRequests.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  recentRequests.set(key, timestamps);
  if (recentRequests.size > 500) {
    for (const [k, list] of recentRequests.entries()) {
      if (list.every(t => now - t >= RATE_WINDOW_MS)) recentRequests.delete(k);
    }
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

  const jwt = authorization.slice(7).trim();
  if (isRateLimited(jwt)) {
    return reply({ error: 'Muitas tentativas de convite. Aguarde alguns minutos.' }, 429);
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    const firstMessage = parsed.error.issues[0]?.message || 'Confira nome, e-mail e papel.';
    return reply({ error: firstMessage }, 400);
  }

  const { name, email, role } = parsed.data;
  const db = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await db.rpc('kroner_team', {
    action: 'invite',
    payload: { name, email, role },
  });

  if (error) {
    const safeMessage = SAFE_RPC_ERRORS.has(error.message)
      ? error.message
      : 'Não foi possível criar o convite. Verifique os dados e tente novamente.';
    return reply({ error: safeMessage }, 400);
  }

  // Não trafega o token secreto na query string (?next=/equipe); o convidado aceita em /equipe via e-mail verificado
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
          email_address: email,
          redirect_url: url.toString(),
          expires_in_days: 7,
          notify: true,
          ignore_existing: true,
        }),
      });
      sent = result.ok;
    } catch {
      sent = false;
    }
  }

  return reply({ token: data?.token, sent }, 200);
}
