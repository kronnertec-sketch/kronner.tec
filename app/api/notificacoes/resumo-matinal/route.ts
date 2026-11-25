import { handleSchedule } from '@vercel/schedules';
import { pendingHolidays } from '@/lib/holidays';
import {
  getAdminSupabase,
  isWebPushConfigured,
  sendPushBatch,
  type StoredPushSubscription,
} from '@/lib/server-push';

export const dynamic = 'force-dynamic';

type ShopProfessionalBrief = {
  id: string;
  userId: string;
  role: 'owner' | 'partner' | 'employee';
  name: string;
  todayCount: number;
  firstTime: string | null;
  subscriptions: StoredPushSubscription[];
};

type ShopMorningBrief = {
  shopId: string;
  shopName: string;
  day: string;
  timezone: string;
  state: string;
  holidayDecisions: Record<string, string>;
  calendar: Array<{ date: string; name: string; scope: string }>;
  overdueCount: number;
  variableDueToday: string[];
  professionals: ShopProfessionalBrief[];
};

function buildMorningCopy(shop: ShopMorningBrief, prof: ShopProfessionalBrief) {
  const isManager = prof.role === 'owner' || prof.role === 'partner';
  const parts: string[] = [];

  if (prof.todayCount > 0) {
    const label = prof.todayCount === 1 ? '1 atendimento hoje' : `${prof.todayCount} atendimentos hoje`;
    parts.push(prof.firstTime ? `${label} (primeiro às ${prof.firstTime})` : label);
  } else {
    parts.push('Agenda livre hoje por enquanto');
  }

  if (isManager && shop.overdueCount > 0) {
    parts.push(
      shop.overdueCount === 1
        ? '1 pagamento em atraso'
        : `${shop.overdueCount} pagamentos em atraso`
    );
  }

  if (isManager && Array.isArray(shop.variableDueToday) && shop.variableDueToday.length > 0) {
    parts.push(
      shop.variableDueToday.length === 1
        ? `Despesa variável hoje: ${shop.variableDueToday[0]}`
        : `${shop.variableDueToday.length} despesas variáveis vencem hoje`
    );
  }

  const upcomingHolidays = pendingHolidays(
    shop.day,
    shop.holidayDecisions || {},
    shop.state || undefined,
    shop.calendar || []
  ).filter((item) => item.days <= 14);

  if (upcomingHolidays.length > 0) {
    const nextH = upcomingHolidays[0];
    const brDate = nextH.date.split('-').reverse().slice(0, 2).join('/');
    parts.push(`Feriado pendente: ${nextH.name} (${brDate})`);
  }

  const firstName = (prof.name || '').trim().split(/\s+/)[0] || '';
  const title = firstName ? `Bom dia, ${firstName}! Resumo do dia` : 'Bom dia! Resumo da barbearia';
  const body = parts.join(' · ');
  const shouldNotify =
    prof.todayCount > 0 ||
    (isManager && (shop.overdueCount > 0 || shop.variableDueToday.length > 0)) ||
    upcomingHolidays.length > 0;

  return { title, body, shouldNotify };
}

export const POST = handleSchedule(async (metadata) => {
  const admin = getAdminSupabase();
  if (!admin) {
    console.warn('[resumo-matinal] SUPABASE_SERVICE_ROLE_KEY ausente; pulando envio.');
    return;
  }

  const collected = await admin.rpc('kroner_collect_morning_summary', {
    p_execution_id: metadata.executionId,
  });

  if (collected.error || !Array.isArray(collected.data)) {
    console.error('[resumo-matinal] erro ao coletar resumo:', collected.error?.message);
    return;
  }

  const shops = collected.data as ShopMorningBrief[];
  const canPush = isWebPushConfigured();

  for (const shop of shops) {
    for (const prof of shop.professionals || []) {
      const { title, body, shouldNotify } = buildMorningCopy(shop, prof);
      if (!shouldNotify) continue;

      let sent = 0;
      if (canPush && Array.isArray(prof.subscriptions) && prof.subscriptions.length > 0) {
        const res = await sendPushBatch(
          prof.subscriptions,
          {
            title,
            body,
            url: '/painel?tab=agenda',
            tag: `kronner-morning-${shop.day}`,
          },
          admin
        );
        sent = res.sent;
      }

      await admin.rpc('kroner_record_morning_notice', {
        p_shop: shop.shopId,
        p_recipient_user_id: prof.userId,
        p_professional_id: prof.id,
        p_day: shop.day,
        p_title: title,
        p_body: body,
        p_push_sent: sent > 0,
      });
    }
  }
});
