import { createClient } from '@supabase/supabase-js';

export type SubscriptionSyncPayload = {
  shop: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  seatLimit: number;
  currentPeriodEnd: string | null;
};

/**
 * Persists Stripe subscription entitlement into Postgres via a service_role-only RPC.
 * Fails silently with a server log only if SUPABASE_SERVICE_ROLE_KEY is not yet configured.
 */
export async function syncShopSubscription(payload: SubscriptionSyncPayload): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return false;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.rpc('kroner_sync_subscription', {
    p_shop: payload.shop,
    p_stripe_customer_id: payload.stripeCustomerId,
    p_stripe_subscription_id: payload.stripeSubscriptionId,
    p_status: payload.status,
    p_seat_limit: Math.max(1, Math.min(101, Math.trunc(payload.seatLimit))),
    p_current_period_end: payload.currentPeriodEnd,
  });

  if (error) {
    console.error('[billing-sync] failed to sync subscription to Postgres:', error.message);
    return false;
  }
  return true;
}
