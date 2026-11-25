import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from '@/lib/server-origin';
import {
  getAdminSupabase,
  isWebPushConfigured,
  sendPushBatch,
  type StoredPushSubscription,
} from '@/lib/server-push';

export const dynamic = 'force-dynamic';

const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;
const testPushRate = new Map<string, number[]>();

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return reply({ error: 'Entre na sua conta.' }, 401);
  }

  if (!isWebPushConfigured()) {
    return reply(
      { error: 'Notificações push ainda não estão configuradas no servidor (chaves VAPID).' },
      503
    );
  }

  const supabaseEnv = getSupabaseEnv();
  const admin = getAdminSupabase();
  if (!supabaseEnv || !admin) {
    return reply({ error: 'Serviço de notificações indisponível no momento.' }, 503);
  }

  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  const p256dh = typeof body?.p256dh === 'string' ? body.p256dh.trim() : '';
  const auth = typeof body?.auth === 'string' ? body.auth.trim() : '';

  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return reply({ error: 'Inscrição push inválida neste aparelho.' }, 400);
  }

  // Verify user is an active barber and owns this exact endpoint in DB
  const userClient = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => authHeader.slice(7),
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const check = await userClient.rpc('kroner_notifications', {
    action: 'has_subscription',
    payload: { endpoint },
  });

  if (check.error || !check.data?.registered) {
    return reply({ error: 'Ative as notificações primeiro neste aparelho.' }, 403);
  }

  const now = Date.now();
  const hits = (testPushRate.get(endpoint) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return reply({ error: 'Aguarde um minuto antes de enviar outro teste.' }, 429);
  }
  hits.push(now);
  testPushRate.set(endpoint, hits);
  if (testPushRate.size > 500) {
    const first = testPushRate.keys().next().value;
    if (first) testPushRate.delete(first);
  }

  const sub: StoredPushSubscription = { endpoint, p256dh, auth };
  const result = await sendPushBatch(
    [sub],
    {
      title: 'Notificações da Kronner ativadas!',
      body: 'Você será avisado por aqui quando houver novos agendamentos, cancelamentos e no resumo matinal.',
      url: '/painel?tab=notices',
      tag: 'kronner-push-test',
    },
    admin
  );

  if (result.sent === 0) {
    return reply({ error: 'Não foi possível entregar a notificação de teste neste aparelho.' }, 502);
  }

  return reply({ ok: true, sent: result.sent });
}
