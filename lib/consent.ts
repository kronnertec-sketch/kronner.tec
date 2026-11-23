export type CookiePreferences = {
  essential: true;
  analytics: boolean;
  updatedAt: string;
};

export const CONSENT_STORAGE_KEY = 'kroner:cookie-consent:v1';
export const CONSENT_EVENT = 'kroner:consent-updated';
export const OPEN_CONSENT_EVENT = 'kroner:open-cookie-settings';

export function readConsent(): CookiePreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
    if (typeof parsed.analytics !== 'boolean') return null;
    return {
      essential: true,
      analytics: parsed.analytics,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveConsent(analytics: boolean): CookiePreferences {
  const prefs: CookiePreferences = {
    essential: true,
    analytics,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(prefs));
      window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: prefs }));
    } catch {}
  }
  return prefs;
}

export function openCookieSettings() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT));
  }
}
