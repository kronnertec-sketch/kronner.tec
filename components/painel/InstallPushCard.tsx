'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Download,
  Monitor,
  PlusSquare,
  Send,
  Share,
  Smartphone,
} from 'lucide-react';
import {
  detectDeviceEnvironment,
  getExistingPushSubscription,
  registerKronnerServiceWorker,
  subscribeDevicePush,
  type DeviceEnvironment,
  type PushSubscriptionPayload,
} from '@/lib/push-client';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __kronnerInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

type InstallPushCardProps = {
  call: (action: string, payload?: Record<string, unknown>) => Promise<any>;
  getToken: () => Promise<string | null>;
  onToast: (message: string) => void;
};

export function InstallPushCard({ call, getToken, onToast }: InstallPushCardProps) {
  const [env, setEnv] = useState<DeviceEnvironment | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [subscription, setSubscription] = useState<PushSubscriptionPayload | null>(null);
  const [serverRegistered, setServerRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [checking, setChecking] = useState(true);

  const refreshState = useCallback(async () => {
    const currentEnv = detectDeviceEnvironment();
    setEnv(currentEnv);

    await registerKronnerServiceWorker();

    const existing = await getExistingPushSubscription();
    setSubscription(existing);

    if (existing && currentEnv.permission === 'granted') {
      try {
        const res = await call('notify:has_subscription', { endpoint: existing.endpoint });
        if (res?.registered) {
          setServerRegistered(true);
        } else {
          // Browser already had permission/subscription — sync silently to Supabase
          await call('notify:save_subscription', existing);
          setServerRegistered(true);
        }
      } catch {
        setServerRegistered(false);
      }
    } else {
      setServerRegistered(false);
    }

    setChecking(false);
  }, [call]);

  useEffect(() => {
    void refreshState();

    if (typeof window === 'undefined') return;
    if (window.__kronnerInstallPrompt) {
      setInstallPrompt(window.__kronnerInstallPrompt);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__kronnerInstallPrompt = promptEvent;
      setInstallPrompt(promptEvent);
    };

    const onAppInstalled = () => {
      window.__kronnerInstallPrompt = null;
      setInstallPrompt(null);
      setEnv(detectDeviceEnvironment());
      onToast('Kronner adicionada à tela inicial!');
    };

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayModeChange = () => setEnv(detectDeviceEnvironment());

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    mql?.addEventListener?.('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      mql?.removeEventListener?.('change', onDisplayModeChange);
    };
  }, [refreshState, onToast]);

  async function handleInstall() {
    if (!installPrompt) return;
    setStatusError('');
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        window.__kronnerInstallPrompt = null;
        setInstallPrompt(null);
        setEnv(detectDeviceEnvironment());
        onToast('Instalando a Kronner na sua tela inicial…');
      }
    } catch {
      setStatusError('Não foi possível abrir o instalador agora. Use o menu do navegador.');
    }
  }

  async function handleEnablePush() {
    setBusy(true);
    setStatusError('');
    try {
      const result = await subscribeDevicePush();
      if (result.error || !result.subscription) {
        setStatusError(result.error || 'Não foi possível ativar as notificações.');
        setEnv(detectDeviceEnvironment());
        return;
      }

      await call('notify:save_subscription', result.subscription);
      setSubscription(result.subscription);
      setServerRegistered(true);
      setEnv(detectDeviceEnvironment());
      onToast('Notificações ativadas neste aparelho!');
    } catch (err) {
      setStatusError((err as Error).message || 'Erro ao salvar notificações neste aparelho.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTest() {
    if (!subscription) return;
    setTesting(true);
    setStatusError('');
    try {
      const token = await getToken();
      if (!token) {
        setStatusError('Sessão expirada. Recarregue a página e tente novamente.');
        return;
      }
      const res = await fetch('/api/notificacoes/teste', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatusError(json.error || 'Não foi possível enviar o teste agora.');
        return;
      }
      onToast('Notificação de teste enviada para este aparelho!');
    } catch {
      setStatusError('Erro de conexão ao enviar o teste.');
    } finally {
      setTesting(false);
    }
  }

  if (checking || !env) return null;

  const isMobile = env.platform === 'ios' || env.platform === 'android';
  const pushActive = serverRegistered && env.permission === 'granted' && Boolean(subscription);
  const installDone = env.isStandalone;
  const setupComplete = isMobile ? installDone && pushActive : pushActive;

  // Once setup is complete on this device, collapse the setup card into a discreet 1-line active bar
  if (setupComplete) {
    return (
      <div className="kr-push-active-bar">
        <div className="kr-push-active-info">
          <CheckCircle2 size={16} />
          <span>
            Notificações ativas neste{' '}
            {env.platform === 'ios'
              ? 'iPhone'
              : env.platform === 'android'
                ? 'Android'
                : 'computador'}
            . Novos agendamentos, cancelamentos e o resumo matinal chegam direto na tela.
          </span>
        </div>
        <button
          type="button"
          className="btn small"
          disabled={testing}
          onClick={handleSendTest}
        >
          <Send size={13} /> {testing ? 'Enviando…' : 'Testar alerta'}
        </button>
      </div>
    );
  }

  const platformLabel =
    env.platform === 'ios'
      ? 'iPhone / iPad'
      : env.platform === 'android'
        ? 'Android'
        : 'Computador';

  const DeviceIcon = env.platform === 'desktop' ? Monitor : Smartphone;
  const iosNeedsInstallFirst = env.platform === 'ios' && !env.isStandalone;

  return (
    <section className="card kr-install-card" aria-label="Instalar Kronner e ativar notificações">
      <div className="kr-install-head">
        <div className="kr-install-title-wrap">
          <span className="kr-install-icon" aria-hidden="true">
            <BellRing size={20} />
          </span>
          <div>
            <div className="kr-install-badges">
              <span className="kr-device-pill">
                <DeviceIcon size={12} /> {platformLabel}
              </span>
              {installDone && (
                <span className="kr-step-done-pill">
                  <CheckCircle2 size={12} /> App instalado
                </span>
              )}
              {pushActive && (
                <span className="kr-step-done-pill">
                  <CheckCircle2 size={12} /> Alertas ativos
                </span>
              )}
            </div>
            <h3>Receba alertas na barra do seu {env.platform === 'desktop' ? 'computador' : 'celular'}</h3>
            <p>
              Saiba na hora quando um cliente agendar, cancelar ou remarcar pelo link — e receba o
              resumo da agenda todo dia às 8h, mesmo com a Kronner fechada.
            </p>
          </div>
        </div>
      </div>

      {statusError && (
        <div role="alert" className="notice danger" style={{ margin: '12px 0 0' }}>
          {statusError}
        </div>
      )}

      {env.permission === 'denied' && (
        <div className="kr-install-blocked">
          <AlertTriangle size={16} />
          <span>
            As notificações foram bloqueadas neste navegador.{' '}
            {env.platform === 'ios'
              ? 'Abra Ajustes > Notificações > Kronner no iPhone para permitir.'
              : 'Clique no ícone de cadeado/permissões ao lado do endereço do site e libere Notificações.'}
          </span>
        </div>
      )}

      <div className="kr-install-steps">
        {/* STEP 1: INSTALL TO HOME SCREEN / DESKTOP */}
        {!installDone && (isMobile || installPrompt) && (
          <div className="kr-install-step">
            <div className="kr-install-step-num">1</div>
            <div className="kr-install-step-body">
              <strong>
                {env.platform === 'ios'
                  ? 'Adicione a Kronner à Tela de Início'
                  : env.platform === 'android'
                    ? 'Instale o aplicativo da Kronner no celular'
                    : 'Instale a Kronner no computador (opcional)'}
              </strong>

              {env.platform === 'ios' ? (
                env.isIosInAppBrowser ? (
                  <p>
                    Você abriu a Kronner dentro de outro aplicativo. Toque no menu e escolha{' '}
                    <b>Abrir no Safari</b> para adicionar à Tela de Início e liberar as notificações
                    no iPhone.
                  </p>
                ) : (
                  <ol className="kr-ios-guide">
                    <li>
                      Toque em{' '}
                      <span className="kr-ios-chip">
                        <Share size={13} /> Compartilhar
                      </span>{' '}
                      na barra inferior do Safari.
                    </li>
                    <li>
                      Role e toque em{' '}
                      <span className="kr-ios-chip">
                        <PlusSquare size={13} /> Adicionar à Tela de Início
                      </span>
                      .
                    </li>
                    <li>Feche o Safari e abra a Kronner pelo ícone criado na tela inicial.</li>
                  </ol>
                )
              ) : installPrompt ? (
                <div className="kr-install-step-action">
                  <p>
                    Cria o ícone da Kronner na sua tela inicial para abrir em tela cheia igual a um
                    aplicativo nativo.
                  </p>
                  <button type="button" className="btn primary" onClick={handleInstall}>
                    <Download size={15} /> Instalar aplicativo da Kronner
                  </button>
                </div>
              ) : (
                <p>
                  No menu do navegador (<b>⋮</b> no canto superior direito), toque em{' '}
                  <b>&ldquo;Adicionar à tela inicial&rdquo;</b> ou <b>&ldquo;Instalar app&rdquo;</b>
                  .
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: ENABLE WEB PUSH NOTIFICATIONS */}
        {!pushActive && (
          <div className={`kr-install-step ${iosNeedsInstallFirst ? 'is-waiting' : ''}`}>
            <div className="kr-install-step-num">{!installDone && (isMobile || installPrompt) ? '2' : '1'}</div>
            <div className="kr-install-step-body">
              <strong>
                Ative as notificações neste{' '}
                {env.platform === 'ios'
                  ? 'iPhone'
                  : env.platform === 'android'
                    ? 'Android'
                    : 'computador'}
              </strong>
              {iosNeedsInstallFirst ? (
                <p>
                  Assim que você abrir a Kronner pelo ícone da Tela de Início, este botão ficará
                  liberado para ativar os alertas oficiais do iOS.
                </p>
              ) : (
                <div className="kr-install-step-action">
                  <p>
                    Permita os alertas para receber novos agendamentos, cancelamentos, remarcações e
                    o resumo matinal direto na barra de notificações.
                  </p>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy || env.permission === 'denied'}
                    onClick={handleEnablePush}
                  >
                    <BellRing size={15} />{' '}
                    {busy ? 'Ativando…' : 'Ativar notificações neste aparelho'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
