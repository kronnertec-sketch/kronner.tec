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

  const periodEndUnix = sub.items.data.reduce<number | null>((acc, item) => {
    const end = item.current_period_end;
    if (typeof end !== 'number') return acc;
    return acc === null ? end : Math.max(acc, end);
  }, null);

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
