'use client';

export type DevicePlatform = 'ios' | 'android' | 'desktop';

export type DeviceEnvironment = {
  platform: DevicePlatform;
  isStandalone: boolean;
  isIosSafari: boolean;
  isIosInAppBrowser: boolean;
  supportsPush: boolean;
  permission: NotificationPermission | 'unsupported';
};

export type PushSubscriptionPayload = {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: DevicePlatform;
  standalone: boolean;
  userAgent: string;
};

export function detectDeviceEnvironment(): DeviceEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      platform: 'desktop',
      isStandalone: false,
      isIosSafari: false,
      isIosInAppBrowser: false,
      supportsPush: false,
      permission: 'unsupported',
    };
  }

  const ua = navigator.userAgent || '';
  const isIpadDesktopUa = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/i.test(ua) || isIpadDesktopUa;
  const isAndroid = /Android/i.test(ua);
  const platform: DevicePlatform = isIos ? 'ios' : isAndroid ? 'android' : 'desktop';

  const navWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navWithStandalone.standalone === true;

  const isInApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|TikTok|Snapchat|MicroMessenger/i.test(ua);
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
  const isIosSafari = isIos && !isInApp && !isOtherIosBrowser && /Safari/i.test(ua);
  const isIosInAppBrowser = isIos && (isInApp || isOtherIosBrowser);

  const hasNotificationApi = 'Notification' in window;
  const supportsPush =
    'serviceWorker' in navigator && 'PushManager' in window && hasNotificationApi;

  const permission: NotificationPermission | 'unsupported' = hasNotificationApi
    ? Notification.permission
    : 'unsupported';

  return {
    platform,
    isStandalone,
    isIosSafari,
    isIosInAppBrowser,
    supportsPush,
    permission,
  };
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerKronnerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    return registration;
  } catch (err) {
    console.error('[sw] registration failed:', err);
    return null;
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscriptionPayload | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration('/')) ||
      (await registerKronnerServiceWorker());
    if (!reg || !('pushManager' in reg)) return null;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return null;
    const json = existing.toJSON();
    const p256dh = json.keys?.p256dh || '';
    const auth = json.keys?.auth || '';
    if (!existing.endpoint || !p256dh || !auth) return null;
    const env = detectDeviceEnvironment();
    return {
      endpoint: existing.endpoint,
      p256dh,
      auth,
      platform: env.platform,
      standalone: env.isStandalone,
      userAgent: (navigator.userAgent || '').slice(0, 260),
    };
  } catch {
    return null;
  }
}

export async function subscribeDevicePush(): Promise<{
  subscription?: PushSubscriptionPayload;
  error?: string;
  denied?: boolean;
}> {
  const env = detectDeviceEnvironment();

  if (env.platform === 'ios' && !env.isStandalone) {
    return {
      error: 'No iPhone, adicione a Kronner à Tela de Início primeiro e abra pelo ícone para ativar notificações.',
    };
  }

  if (!env.supportsPush) {
    return {
      error: 'Este navegador não suporta notificações push. Tente pelo Chrome, Edge ou Safari atualizado.',
    };
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublicKey) {
    return {
      error: 'Chave de notificação do servidor ainda não configurada.',
    };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      denied: permission === 'denied',
      error:
        permission === 'denied'
          ? 'Permissão bloqueada no navegador. Libere as notificações nas configurações do site.'
          : 'Permissão de notificações não confirmada.',
    };
  }

  const reg = await registerKronnerServiceWorker();
  if (!reg) {
    return { error: 'Não foi possível iniciar o serviço de notificações neste navegador.' };
  }

  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!sub.endpoint || !p256dh || !auth) {
    return { error: 'Não foi possível gerar a chave de notificação deste aparelho.' };
  }

  return {
    subscription: {
      endpoint: sub.endpoint,
      p256dh,
      auth,
      platform: env.platform,
      standalone: env.isStandalone,
      userAgent: (navigator.userAgent || '').slice(0, 260),
    },
  };
}

export async function notifyAppointmentEvent(
  token: string | null | undefined,
  appointmentId: string | null | undefined,
  kind: 'booking_created' | 'booking_cancelled' | 'booking_rescheduled'
): Promise<void> {
  if (!token || !appointmentId) return;
  try {
    await fetch('/api/notificacoes/evento', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ appointmentId, kind }),
      keepalive: true,
    });
  } catch {
    // Non-blocking: DB notice is already persisted in the in-app bell
  }
}
