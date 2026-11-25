import type { NextConfig } from 'next';

let analyticsOrigin = '';
const rawAnalyticsUrl = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL?.trim();
if (rawAnalyticsUrl) {
  try {
    const parsed = new URL(rawAnalyticsUrl);
    if (parsed.protocol === 'https:') analyticsOrigin = ' ' + parsed.origin;
  } catch {
    analyticsOrigin = '';
  }
}

let supabaseConnect = 'https://*.supabase.co wss://*.supabase.co';
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
if (rawSupabaseUrl) {
  try {
    const parsed = new URL(rawSupabaseUrl);
    if (parsed.protocol === 'https:') {
      supabaseConnect = `${parsed.origin} wss://${parsed.host}`;
    }
  } catch {
    // fallback to wildcard only if env var is invalid
  }
}

function resolveClerkOrigin(): string {
  const override = process.env.NEXT_PUBLIC_CLERK_FRONTEND_API?.trim();
  if (override) {
    try {
      const parsed = new URL(override.startsWith('https://') ? override : `https://${override}`);
      if (parsed.protocol === 'https:') return parsed.origin;
    } catch {}
  }

  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || '';
  const match = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(pk);
  if (match) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8').replace(/\$$/, '').trim();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(decoded)) {
        return `https://${decoded}`;
      }
    } catch {}
  }

  return 'https://electric-ibex-2341.clerk.accounts.dev';
}

const clerkHost = resolveClerkOrigin();

const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  `script-src 'self' 'unsafe-inline' ${clerkHost} https://*.clerk.com https://challenges.cloudflare.com https://js.stripe.com${analyticsOrigin}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: https://img.clerk.com https://images.clerk.dev ${clerkHost} https://*.clerk.com`,
  `connect-src 'self' ${supabaseConnect} ${clerkHost} https://*.clerk.com https://api.stripe.com https://viacep.com.br https://brasilapi.com.br${analyticsOrigin}`,
  `frame-src 'self' ${clerkHost} https://*.clerk.com https://challenges.cloudflare.com https://checkout.stripe.com https://js.stripe.com https://hooks.stripe.com`,
  "worker-src 'self' blob:",
].join('; ');

const config: NextConfig = {
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: cspDirectives },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
