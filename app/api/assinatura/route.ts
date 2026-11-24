import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnv, resolvePublicOrigin } from '@/lib/server-origin';
import { syncShopSubscription } from '@/lib/server-billing-sync';

export const dynamic = 'force-dynamic';

/**
 * Preços do Stripe: usa as variáveis de ambiente se existirem; senão busca pelos
 * lookup_keys criados na conta (kroner_base_monthly / kroner_chair_monthly).
 */
async function resolvePrices(stripe: Stripe) {
  let base = process.env.STRIPE_BASE_PRICE_ID;
  let seat = process.env.STRIPE_CHAIR_PRICE_ID;
  if (!base || !seat) {
    const found = await stripe.prices.list({
      lookup_keys: ['kroner_base_monthly', 'kroner_chair_monthly'],
      active: true,
      limit: 2,
    });
    base ||= found.data.find(p => p.lookup_key === 'kroner_base_monthly')?.id;
    seat ||= found.data.find(p => p.lookup_key === 'kroner_chair_monthly')?.id;
  }
  if (!base || !seat) throw new Error('Preços da Kronner não encontrados no Stripe.');
  return { basePrice: base, seatPrice: seat };
}

const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function isAllowlistedTestShop(shopId: string): boolean {
  const raw = process.env.KRONER_TEST_SHOP_IDS?.trim();
  if (!raw) return false;
  return raw
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(shopId.toLowerCase());
}

export function GET() {
  return reply({ available: true });
}

export async function POST(request: Request) {
  const token = request.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return reply({ error: 'Entre com sua conta.' }, 401);

  const origin = resolvePublicOrigin(request);
  if (!origin) {
    return reply({ error: 'Origem pública da aplicação não configurada.' }, 503);
  }

  const supabaseEnv = getSupabaseEnv();
  if (!supabaseEnv) {
    return reply({ error: 'Serviço de dados não configurado.' }, 503);
  }

  const body = await request.json().catch(() => null);
  if (!body || !['status', 'iniciar', 'cadeiras', 'portal'].includes(body.action)) {
    return reply({ error: 'Operação inválida.' }, 400);
  }

  // Autentica e valida o titular da barbearia criptograficamente via Supabase + Clerk JWKS
  const api = createClient(supabaseEnv.url, supabaseEnv.publishableKey, {
    accessToken: async () => token.slice(7),
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: shop, error } = await api.rpc('kroner_billing_owner');
  if (error) return reply({ error: 'Não foi possível validar o titular da barbearia.' }, 503);
  if (typeof shop !== 'string' || !/^[a-f0-9-]{36}$/i.test(shop)) {
    return reply({ error: 'Somente a conta principal pode gerenciar a assinatura.' }, 403);
  }

  // Opcional: bypass de testes SOMENTE após validação criptográfica do titular e via env server-side
  if (isAllowlistedTestShop(shop)) {
    if (body.action === 'status') {
      return reply({
        status: 'active',
        extras: 99,
        trialEnd: null,
        isTestAccount: true,
      });
    }
    if (body.action === 'cadeiras') {
      return reply({ ok: true, isTestAccount: true });
    }
    return reply({ url: origin + '/painel', isTestAccount: true });
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return reply({ error: 'A cobrança ainda aguarda configuração na Vercel.' }, 503);

  const stripe = new Stripe(key);

  try {
    const { basePrice, seatPrice } = await resolvePrices(stripe);
    const matches = await stripe.customers.search({
      query: "metadata['kroner_shop']:'" + shop + "'",
      limit: 2,
    });
    if (matches.data.length > 1) {
      return reply({ error: 'Cadastro de cobrança duplicado. Contate o suporte.' }, 409);
    }
    let customer = matches.data[0];
    if (!customer && body.action === 'iniciar') {
      customer = await stripe.customers.create(
        { metadata: { kroner_shop: shop } },
        { idempotencyKey: 'kroner-customer-' + shop }
      );
    }
    if (!customer) {
      return body.action === 'status'
        ? reply({ status: 'sem_assinatura', extras: 0 })
        : reply({ error: 'Inicie a assinatura antes de acessar a cobrança.' }, 409);
    }

    const history = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 100 });
    const subscription = history.data.find(
      s => s.items.data.some(i => i.price.id === basePrice) && !['canceled', 'incomplete_expired'].includes(s.status)
    );
    const seat = subscription?.items.data.find(i => i.price.id === seatPrice);

    const periodEndUnix = subscription
      ? subscription.items.data.reduce<number | null>((acc, item) => {
          const end = item.current_period_end;
          if (typeof end !== 'number') return acc;
          return acc === null ? end : Math.max(acc, end);
        }, null)
      : null;

    if (subscription) {
      await syncShopSubscription({
        shop,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        seatLimit: 1 + (seat?.quantity || 0),
        currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
      });
    } else if (history.data[0]) {
      await syncShopSubscription({
        shop,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: history.data[0].id,
        status: history.data[0].status,
        seatLimit: 1,
        currentPeriodEnd: null,
      });
    }

    if (body.action === 'status') {
      return reply({
        status: subscription?.status || 'sem_assinatura',
        extras: seat?.quantity || 0,
        trialEnd: subscription?.trial_end,
      });
    }

    if (body.action === 'portal') {
      const result = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: origin + '/painel',
      });
      return reply({ url: result.url });
    }

    if (body.action === 'cadeiras') {
      if (!subscription || !['trialing', 'active'].includes(subscription.status)) {
        return reply({ error: 'Ative sua assinatura para ajustar as cadeiras.' }, 409);
      }
      const count = body.quantity;
      if (!Number.isSafeInteger(count) || count < 0 || count > 100) {
        return reply({ error: 'Informe de 0 a 100 cadeiras adicionais.' }, 400);
      }
      if ((seat?.quantity || 0) === count) return reply({ ok: true });

      const invoice = subscription.latest_invoice;
      if (invoice && subscription.status === 'active') {
        const latest = await stripe.invoices.retrieve(typeof invoice === 'string' ? invoice : invoice.id);
        if (latest.amount_remaining > 0) {
          return reply({ error: 'Regularize a fatura em aberto antes de ajustar cadeiras.' }, 409);
        }
      }

      const item = seat
        ? count
          ? { id: seat.id, quantity: count }
          : { id: seat.id, deleted: true }
        : { price: seatPrice, quantity: count };

      const updated = await stripe.subscriptions.update(subscription.id, {
        items: [item],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete',
      });

      const updatedPeriodEnd = updated.items.data.reduce<number | null>((acc, i) => {
        const end = i.current_period_end;
        if (typeof end !== 'number') return acc;
        return acc === null ? end : Math.max(acc, end);
      }, null);

      await syncShopSubscription({
        shop,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: updated.id,
        status: updated.status,
        seatLimit: 1 + count,
        currentPeriodEnd: updatedPeriodEnd ? new Date(updatedPeriodEnd * 1000).toISOString() : null,
      });

      return reply({ ok: true });
    }

    if (subscription) return reply({ error: 'Já existe assinatura para esta barbearia.' }, 409);

    const open = await stripe.checkout.sessions.list({ customer: customer.id, status: 'open', limit: 100 });
    const previous = open.data.find(s => s.mode === 'subscription' && s.client_reference_id === shop);
    if (previous?.url) return reply({ url: previous.url });

    const eligible = !history.data.some(s => s.items.data.some(i => i.price.id === basePrice));
    const session = await stripe.checkout.sessions.create(
      {
        customer: customer.id,
        client_reference_id: shop,
        mode: 'subscription',
        line_items: [{ price: basePrice, quantity: 1 }],
        allowed_payment_method_types: ['card'],
        payment_method_collection: eligible ? 'if_required' : 'always',
        subscription_data: {
          metadata: { kroner_shop: shop },
          ...(eligible
            ? { trial_period_days: 15, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }
            : {}),
        },
        success_url: origin + '/painel',
        cancel_url: origin + '/painel',
      },
      { idempotencyKey: 'checkout-' + shop + '-' + Math.floor(Date.now() / 300000) }
    );
    return reply({ url: session.url });
  } catch {
    return reply(
      { error: 'O Stripe não conseguiu concluir a solicitação. Atualize a situação da assinatura antes de tentar novamente.' },
      502
    );
  }
}
