/**
 * Resolves the canonical public origin for security-sensitive redirects
 * (Clerk invitation links, Stripe Checkout & Billing Portal return URLs).
 *
 * Fails closed (returns null) in production if KRONER_PUBLIC_ORIGIN is missing
 * or invalid, preventing Host / X-Forwarded-Host header poisoning.
 */
export function resolvePublicOrigin(request: Request): string | null {
  const configured = process.env.KRONER_PUBLIC_ORIGIN?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocal)) {
        return parsed.origin;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

export function getSupabaseEnv(): { url: string; publishableKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
