import Stripe from 'stripe';
import {createClient} from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const basePrice = process.env.STRIPE_BASE_PRICE_ID || 'price_1UZK3sK5jxEBUOJHAL7eMrkq';
const seatPrice = process.env.STRIPE_CHAIR_PRICE_ID || 'price_1UZK42K5jxEBUOJHmONdtBbF';
const TEST_EMAILS = ['jorgemartins2k@gmail.com'];

const reply = (data: unknown, status = 200) =>
  Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});

function extractEmailFromJwt(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.slice(7).trim();
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const raw = Buffer.from(parts[1], 'base64').toString('utf8');
    const claims = JSON.parse(raw);
    const email = claims.email || claims.email_address;
    return typeof email === 'string' ? email.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

export function GET() {
  return reply({available: true});
}

export async function POST(request: Request) {
  const token = request.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return reply({error: 'Entre com sua conta.'}, 401);

  const email = extractEmailFromJwt(token);
  const isTestAccount = email ? TEST_EMAILS.includes(email) : false;
  const origin = process.env.KRONER_PUBLIC_ORIGIN || 'https://kroner-eight.vercel.app';

  const body = await request.json().catch(() => null);
  if (!body || !['status', 'iniciar', 'cadeiras', 'portal'].includes(body.action)) {
    return reply({error: 'Operação inválida.'}, 400);
  }

  // Conta liberada para testes: acesso integral sem cobrança
  if (isTestAccount) {
    if (body.action === 'status') {
      return reply({
        status: 'active',
        extras: 99,
        trialEnd: null,
        isTestAccount: true,
      });
    }
    if (body.action === 'cadeiras') {
      return reply({ok: true, isTestAccount: true});
    }
    if (body.action === 'iniciar' || body.action === 'portal') {
      return reply({url: origin + '/painel', isTestAccount: true});
    }
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return reply({error: 'A cobrança ainda aguarda configuração na Vercel.'}, 503);

  const api = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      accessToken: async () => token.slice(7),
      auth: {persistSession: false, autoRefreshToken: false},
    }
  );

  const {data: shop, error} = await api.rpc('kroner_billing_owner');
  if (error) return reply({error: 'Não foi possível validar o titular da barbearia.'}, 503);
  if (typeof shop !== 'string' || !/^[a-f0-9-]{36}$/i.test(shop)) {
    return reply({error: 'Somente a conta principal pode gerenciar a assinatura.'}, 403);
  }

  const stripe = new Stripe(key);

  try {
    const matches = await stripe.customers.search({
      query: "metadata['kroner_shop']:'" + shop + "'",
      limit: 2,
    });
    if (matches.data.length > 1) {
      return reply({error: 'Cadastro de cobrança duplicado. Contate o suporte.'}, 409);
    }
    let customer = matches.data[0];
    if (!customer && body.action === 'iniciar') {
      customer = await stripe.customers.create(
        {metadata: {kroner_shop: shop}},
        {idempotencyKey: 'kroner-customer-' + shop}
      );
    }
    if (!customer) {
      return body.action === 'status'
        ? reply({status: 'sem_assinatura', extras: 0})
        : reply({error: 'Inicie a assinatura antes de acessar a cobrança.'}, 409);
    }

    const history = await stripe.subscriptions.list({customer: customer.id, status: 'all', limit: 100});
    const subscription = history.data.find(
      s => s.items.data.some(i => i.price.id === basePrice) && !['canceled', 'incomplete_expired'].includes(s.status)
    );
    const seat = subscription?.items.data.find(i => i.price.id === seatPrice);

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
      return reply({url: result.url});
    }

    if (body.action === 'cadeiras') {
      if (!subscription || !['trialing', 'active'].includes(subscription.status)) {
        return reply({error: 'Ative sua assinatura para ajustar as cadeiras.'}, 409);
      }
      const count = body.quantity;
      if (!Number.isSafeInteger(count) || count < 0 || count > 100) {
        return reply({error: 'Informe de 0 a 100 cadeiras adicionais.'}, 400);
      }
      if ((seat?.quantity || 0) === count) return reply({ok: true});

      const invoice = subscription.latest_invoice;
      if (invoice && subscription.status === 'active') {
        const latest = await stripe.invoices.retrieve(typeof invoice === 'string' ? invoice : invoice.id);
        if (latest.amount_remaining > 0) {
          return reply({error: 'Regularize a fatura em aberto antes de ajustar cadeiras.'}, 409);
        }
      }

      const item = seat
        ? count
          ? {id: seat.id, quantity: count}
          : {id: seat.id, deleted: true}
        : {price: seatPrice, quantity: count};

      await stripe.subscriptions.update(subscription.id, {
        items: [item],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete',
      });
      return reply({ok: true});
    }

    if (subscription) return reply({error: 'Já existe assinatura para esta barbearia.'}, 409);

    const open = await stripe.checkout.sessions.list({customer: customer.id, status: 'open', limit: 100});
    const previous = open.data.find(s => s.mode === 'subscription' && s.client_reference_id === shop);
    if (previous?.url) return reply({url: previous.url});

    const eligible = !history.data.some(s => s.items.data.some(i => i.price.id === basePrice));
    const session = await stripe.checkout.sessions.create(
      {
        customer: customer.id,
        client_reference_id: shop,
        mode: 'subscription',
        line_items: [{price: basePrice, quantity: 1}],
        allowed_payment_method_types: ['card'],
        payment_method_collection: eligible ? 'if_required' : 'always',
        subscription_data: {
          metadata: {kroner_shop: shop},
          ...(eligible
            ? {trial_period_days: 15, trial_settings: {end_behavior: {missing_payment_method: 'cancel'}}}
            : {}),
        },
        success_url: origin + '/painel',
        cancel_url: origin + '/painel',
      },
      {idempotencyKey: 'checkout-' + shop + '-' + Math.floor(Date.now() / 300000)}
    );
    return reply({url: session.url});
  } catch {
    return reply(
      {error: 'O Stripe não conseguiu concluir a solicitação. Atualize a situação da assinatura antes de tentar novamente.'},
      502
    );
  }
}
