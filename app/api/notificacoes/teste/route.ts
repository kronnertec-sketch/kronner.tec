import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from '@/lib/server-origin';
import {
  getAdminSupabase,
  isAllowedPushEndpoint,
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
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer) {
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

  if (!isAllowedPushEndpoint(endpoint)) {
    return reply({ error: 'Endpoint de notificação push inválido ou não autorizado.' }, 400);
  }

  // Verify user is an active barber and read DB-stored subscription keys (never trust client keys)
  const userClient = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => bearer,
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const check = await userClient.rpc('kroner_notifications', {
    action: 'has_subscription',
    payload: { endpoint },
  });

  if (check.error || !check.data?.registered) {
    return reply({ error: 'Ative as notificações primeiro neste aparelho.' }, 403);
  }

  const dbUserId = typeof check.data?.userId === 'string' ? check.data.userId : endpoint;
  const dbP256dh = typeof check.data?.p256dh === 'string' ? check.data.p256dh : '';
  const dbAuth = typeof check.data?.auth === 'string' ? check.data.auth : '';
  const dbEndpoint = typeof check.data?.endpoint === 'string' ? check.data.endpoint : endpoint;

  if (!dbP256dh || !dbAuth || !isAllowedPushEndpoint(dbEndpoint)) {
    return reply({ error: 'Inscrição push inválida neste aparelho. Reative as notificações.' }, 400);
  }

  // Rate-limit strictly by authenticated userId (cannot be bypassed by rotating endpoints)
  const now = Date.now();
  const hits = (testPushRate.get(dbUserId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    testPushRate.set(dbUserId, hits);
    return reply({ error: 'Aguarde um minuto antes de enviar outro teste.' }, 429);
  }
  hits.push(now);
  testPushRate.set(dbUserId, hits);
  if (testPushRate.size > 500) {
    const first = testPushRate.keys().next().value;
    if (first) testPushRate.delete(first);
  }

  const sub: StoredPushSubscription = { endpoint: dbEndpoint, p256dh: dbP256dh, auth: dbAuth };
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
