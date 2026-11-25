import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from '@/lib/server-origin';
import {
  getAdminSupabase,
  isWebPushConfigured,
  sendPushBatch,
  type StoredPushSubscription,
} from '@/lib/server-push';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_KINDS = new Set(['booking_created', 'booking_cancelled', 'booking_rescheduled']);

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

type ClaimedNotice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tab: string;
  appointmentId: string | null;
  subscriptions: StoredPushSubscription[];
};

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return reply({ error: 'Entre na sua conta.' }, 401);
  }

  const supabaseEnv = getSupabaseEnv();
  if (!supabaseEnv) {
    return reply({ ok: false, skipped: 'supabase_unconfigured' }, 200);
  }

  const body = await request.json().catch(() => null);
  const appointmentId = typeof body?.appointmentId === 'string' ? body.appointmentId.trim() : '';
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : '';

  if (!UUID_RE.test(appointmentId) || !ALLOWED_KINDS.has(kind)) {
    return reply({ error: 'Evento de notificação inválido.' }, 400);
  }

  // 1. Verify caller owns the client appointment via Clerk JWT + Supabase JWKS
  const userClient = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => authHeader.slice(7),
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const verify = await userClient.rpc('kroner_verify_client_appointment', {
    p_appointment: appointmentId,
    p_kind: kind,
  });

  if (verify.error) {
    return reply({ error: 'Não foi possível validar o agendamento.' }, 403);
  }

  // 2. Claim unsent push notifications for this appointment and deliver via Web Push
  if (!isWebPushConfigured()) {
    return reply({ ok: true, sent: 0, skipped: 'vapid_unconfigured' });
  }

  const admin = getAdminSupabase();
  if (!admin) {
    return reply({ ok: true, sent: 0, skipped: 'service_role_unconfigured' });
  }

  const claimed = await admin.rpc('kroner_claim_appointment_pushes', {
    p_appointment: appointmentId,
  });

  if (claimed.error || !Array.isArray(claimed.data)) {
    console.error('[notificacoes/evento] claim failed:', claimed.error?.message);
    return reply({ ok: true, sent: 0 });
  }

  const notices = claimed.data as ClaimedNotice[];
  let totalSent = 0;

  for (const notice of notices) {
    if (!Array.isArray(notice.subscriptions) || notice.subscriptions.length === 0) continue;
    const res = await sendPushBatch(
      notice.subscriptions,
      {
        title: notice.title,
        body: notice.body,
        url: `/painel?tab=${encodeURIComponent(notice.tab || 'agenda')}`,
        tag: `kronner-${notice.kind}-${notice.appointmentId || notice.id}`,
      },
      admin
    );
    totalSent += res.sent;
  }

  return reply({ ok: true, sent: totalSent });
}
