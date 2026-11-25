import * as webpush from 'web-push';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const EXACT_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
  'push.samsungosp.com',
]);

const SUFFIX_PUSH_HOSTS = [
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
  '.push.samsungosp.com',
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Strict Web Push endpoint allowlist to prevent SSRF & tarpit DoS.
 * Accepts only default-port HTTPS URLs hosted on official browser push services.
 */
export function isAllowedPushEndpoint(raw: string): boolean {
  if (!raw || raw.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;

  const host = parsed.hostname.toLowerCase();
  if (!host || host.includes(':') || IPV4_RE.test(host) || host === 'localhost') return false;
  if (!parsed.pathname || parsed.pathname === '/') return false;

  if (EXACT_PUSH_HOSTS.has(host)) return true;
  return SUFFIX_PUSH_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

let vapidConfigured = false;

export function isWebPushConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  return Boolean(pub && priv);
}

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return false;
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:kronner.tec@gmail.com';
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

export function getAdminSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sendPushBatch(
  subscriptions: StoredPushSubscription[],
  payload: PushPayload,
  adminClient?: SupabaseClient | null
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (!subscriptions.length || !ensureVapid()) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const safeUrl =
    payload.url && payload.url.startsWith('/') && !payload.url.startsWith('//')
      ? payload.url
      : '/painel?tab=notices';

  const serialized = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: safeUrl,
    tag: payload.tag || 'kronner-notice',
  });

  const staleEndpoints: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        failed += 1;
        staleEndpoints.push(sub.endpoint);
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          serialized,
          { TTL: 60 * 60 * 12, urgency: 'high', timeout: 8000 }
        );
        sent += 1;
      } catch (err: unknown) {
        failed += 1;
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.error(
            '[web-push] delivery error:',
            statusCode || (err instanceof Error ? err.message : 'unknown')
          );
        }
      }
    })
  );

  let pruned = 0;
  if (staleEndpoints.length > 0) {
    const admin = adminClient ?? getAdminSupabase();
    if (admin) {
      const { data } = await admin.rpc('kroner_delete_stale_push_endpoints', {
        p_endpoints: staleEndpoints,
      });
      if (typeof data === 'number') pruned = data;
    }
  }

  return { sent, failed, pruned };
}
