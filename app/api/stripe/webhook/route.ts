import Stripe from 'stripe';
import { syncShopSubscription } from '@/lib/server-billing-sync';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[a-f0-9-]{36}$/i;

type CachedPrices = { basePrice: string; seatPrice: string; expiresAt: number };
let cachedPrices: CachedPrices | null = null;

async function resolvePrices(stripe: Stripe): Promise<{ basePrice: string; seatPrice: string }> {
  const envBase = process.env.STRIPE_BASE_PRICE_ID?.trim();
  const envSeat = process.env.STRIPE_CHAIR_PRICE_ID?.trim();
  if (envBase && envSeat) return { basePrice: envBase, seatPrice: envSeat };

  if (cachedPrices && cachedPrices.expiresAt > Date.now()) {
    return { basePrice: cachedPrices.basePrice, seatPrice: cachedPrices.seatPrice };
  }

  const found = await stripe.prices.list({
    lookup_keys: ['kroner_base_monthly', 'kroner_chair_monthly'],
    active: true,
    limit: 2,
  });
  const basePrice = envBase || found.data.find(p => p.lookup_key === 'kroner_base_monthly')?.id;
  const seatPrice = envSeat || found.data.find(p => p.lookup_key === 'kroner_chair_monthly')?.id;
  if (!basePrice || !seatPrice) {
    throw new Error('Preços da Kronner não encontrados no Stripe.');
  }
  cachedPrices = { basePrice, seatPrice, expiresAt: Date.now() + 5 * 60 * 1000 };
  return { basePrice, seatPrice };
}

async function resolveShopId(
  stripe: Stripe,
  sub: Stripe.Subscription
): Promise<string | null> {
  const fromSub = sub.metadata?.kroner_shop;
  if (typeof fromSub === 'string' && UUID_RE.test(fromSub)) return fromSub;

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;

  const customer = await stripe.customers.retrieve(customerId);
  if ('deleted' in customer && customer.deleted) return null;
  const fromCustomer = customer.metadata?.kroner_shop;
  return typeof fromCustomer === 'string' && UUID_RE.test(fromCustomer) ? fromCustomer : null;
}

async function syncFromSubscription(
  stripe: Stripe,
  sub: Stripe.Subscription,
  eventCreated: number
) {
  const { basePrice, seatPrice } = await resolvePrices(stripe);
  // [MÉDIA-05] Only sync subscriptions that include the Kronner base plan
  if (!sub.items.data.some(item => item.price.id === basePrice)) {
    return;
  }

  const shop = await resolveShopId(stripe, sub);
  if (!shop) return;

  const seatItem = sub.items.data.find(item => item.price.id === seatPrice);
  const extraSeats = seatItem?.quantity ?? 0;

  const rawPeriodEndUnix = sub.items.data.reduce<number | null>((acc, item) => {
    const end = item.current_period_end;
    if (typeof end !== 'number') return acc;
    return acc === null ? end : Math.max(acc, end);
  }, null);
  const periodEndUnix =
    rawPeriodEndUnix ?? (typeof sub.trial_end === 'number' ? sub.trial_end : null);

  const synced = await syncShopSubscription({
    shop,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    seatLimit: 1 + extraSeats,
    currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    eventCreated,
  });
  if (!synced) {
    throw new Error('Falha ao persistir assinatura no banco de dados.');
  }
}

function isStripeNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { statusCode?: unknown; code?: unknown };
  return e.statusCode === 404 || e.code === 'resource_missing';
}

async function revokeShopFromCustomer(
  stripe: Stripe,
  customerId: string | null,
  status: 'refunded' | 'disputed',
  eventCreated: number
) {
  if (!customerId) return;
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    if (isStripeNotFound(err)) return;
    throw err;
  }
  if ('deleted' in customer && customer.deleted) return;

  const { basePrice } = await resolvePrices(stripe);
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const kronerSubs = subs.data.filter(s => s.items.data.some(i => i.price.id === basePrice));

  const customerShop = customer.metadata?.kroner_shop;
  const subShop = kronerSubs.find(
    s => typeof s.metadata?.kroner_shop === 'string' && UUID_RE.test(s.metadata.kroner_shop)
  )?.metadata?.kroner_shop;
  const shop =
    typeof customerShop === 'string' && UUID_RE.test(customerShop)
      ? customerShop
      : typeof subShop === 'string' && UUID_RE.test(subShop)
        ? subShop
        : null;
  if (!shop) return;

  let latestSubId: string | null = kronerSubs[0]?.id ?? null;

  for (const s of kronerSubs) {
    if (['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)) {
      try {
        await stripe.subscriptions.cancel(s.id);
      } catch (err) {
        // Ignore only if already missing/canceled; rethrow transient errors so Stripe retries
        if (!isStripeNotFound(err)) throw err;
      }
      latestSubId = s.id;
    }
  }

  const synced = await syncShopSubscription({
    shop,
    stripeCustomerId: customerId,
    stripeSubscriptionId: latestSubId,
    status,
    seatLimit: 1,
    currentPeriodEnd: new Date().toISOString(),
    eventCreated,
  });
  if (!synced) {
    throw new Error('Falha ao revogar assinatura no banco de dados.');
  }
}

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeKey || !webhookSecret) {
    return Response.json(
      { error: 'Webhook Stripe não configurado.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json(
      { error: 'Assinatura do webhook ausente.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const rawBody = await request.text();
  const stripe = new Stripe(stripeKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return Response.json(
      { error: 'Assinatura do webhook inválida.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncFromSubscription(stripe, event.data.object as Stripe.Subscription, event.created);
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncFromSubscription(stripe, sub, event.created);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef = invoice.parent?.subscription_details?.subscription;
        if (subRef) {
          const subId = typeof subRef === 'string' ? subRef : subRef.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncFromSubscription(stripe, sub, event.created);
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        // Full refund revokes entitlement and cancels any active Kronner subscription for the customer
        if (charge.refunded === true) {
          const customerId =
            typeof charge.customer === 'string' ? charge.customer : charge.customer?.id ?? null;
          await revokeShopFromCustomer(stripe, customerId, 'refunded', event.created);
        }
        break;
      }
      case 'charge.dispute.created':
      case 'charge.dispute.funds_withdrawn': {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
        if (chargeId) {
          let charge: Stripe.Charge | null = null;
          try {
            charge = await stripe.charges.retrieve(chargeId);
          } catch (err) {
            if (!isStripeNotFound(err)) throw err;
          }
          const customerId = !charge?.customer
            ? null
            : typeof charge.customer === 'string'
              ? charge.customer
              : charge.customer.id;
          await revokeShopFromCustomer(stripe, customerId, 'disputed', event.created);
        }
        break;
      }
      default:
        break;
    }

    return Response.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { error: 'Falha ao processar evento do Stripe.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
