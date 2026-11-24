'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cookie, ShieldCheck, X } from 'lucide-react';
import {
  CONSENT_EVENT,
  OPEN_CONSENT_EVENT,
  readConsent,
  saveConsent,
  type CookiePreferences,
} from '@/lib/consent';

const ANALYTICS_SCRIPT_URL = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL || '';
const ANALYTICS_DOMAIN = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN || '';

export function CookieConsent() {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [analyticsDraft, setAnalyticsDraft] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    setPrefs(existing);
    setAnalyticsDraft(existing?.analytics ?? false);
    setReady(true);

    const onOpen = () => {
      const current = readConsent();
      setAnalyticsDraft(current?.analytics ?? false);
      setModalOpen(true);
    };
    const onUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<CookiePreferences>).detail;
      if (detail) setPrefs(detail);
    };

    window.addEventListener(OPEN_CONSENT_EVENT, onOpen);
    window.addEventListener(CONSENT_EVENT, onUpdated);
    return () => {
      window.removeEventListener(OPEN_CONSENT_EVENT, onOpen);
      window.removeEventListener(CONSENT_EVENT, onUpdated);
    };
  }, []);

  // Carrega script de medição opcional SOMENTE após consentimento explícito (LGPD) e URL https:// válida
  // Ao revogar consentimento, remove o script e recarrega a página para encerrar hooks em memória
  useEffect(() => {
    const existingScript = document.querySelector('script[data-kroner-analytics="true"]');
    if (!prefs?.analytics) {
      if (existingScript) {
        existingScript.remove();
        window.location.reload();
      }
      return;
    }
    if (!ANALYTICS_SCRIPT_URL) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(ANALYTICS_SCRIPT_URL);
    } catch {
      return;
    }
    if (parsedUrl.protocol !== 'https:') return;
    if (existingScript) return;
    const script = document.createElement('script');
    script.src = parsedUrl.toString();
    script.defer = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.dataset.kronerAnalytics = 'true';
    if (ANALYTICS_DOMAIN) script.dataset.domain = ANALYTICS_DOMAIN;
    document.head.appendChild(script);
  }, [prefs?.analytics]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  const handleSave = (analytics: boolean) => {
    const next = saveConsent(analytics);
    setPrefs(next);
    setAnalyticsDraft(analytics);
    setModalOpen(false);
  };

  if (!ready) return null;

  return (
    <>
      {!prefs && !modalOpen && (
        <aside
          className="cookie-banner"
          role="region"
          aria-label="Aviso de cookies e privacidade"
        >
          <div className="cookie-banner-head">
            <span className="cookie-icon" aria-hidden="true">
              <Cookie size={18} />
            </span>
            <div>
              <strong>Sua privacidade e cookies</strong>
              <p>
                Usamos cookies essenciais para manter seu acesso seguro e lembrar o andamento do
                agendamento. Cookies opcionais de medição só são ativados com a sua autorização.
                Veja nossa{' '}
                <Link href="/privacidade">Política de Privacidade</Link> e{' '}
                <Link href="/cookies">Política de Cookies</Link>.
              </p>
            </div>
          </div>
          <div className="cookie-banner-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => handleSave(false)}
            >
              Apenas essenciais
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => setModalOpen(true)}
            >
              Personalizar
            </button>
            <button
              type="button"
              className="btn primary small"
              onClick={() => handleSave(true)}
            >
              Aceitar todos
            </button>
          </div>
        </aside>
      )}

      {modalOpen && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <section
            className="modal cookie-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-modal-title"
          >
            <div className="split">
              <h2 id="cookie-modal-title">Preferências de cookies</h2>
              <button
                type="button"
                className="close"
                aria-label="Fechar preferências de cookies"
                onClick={() => setModalOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p>
              Você decide quais categorias opcionais deseja autorizar. Sua escolha pode ser
              alterada a qualquer momento pela página de{' '}
              <Link href="/cookies" onClick={() => setModalOpen(false)}>
                Política de Cookies
              </Link>
              .
            </p>

            <div className="cookie-option">
              <div>
                <strong>Cookies essenciais</strong>
                <small>
                  Necessários para autenticação segura (Clerk), funcionamento do painel e
                  agendamento. Não podem ser desativados.
                </small>
              </div>
              <span className="badge green">
                <ShieldCheck size={12} aria-hidden="true" /> Sempre ativo
              </span>
            </div>

            <div className="cookie-option">
              <div>
                <strong>Medição e melhoria do sistema (opcional)</strong>
                <small>
                  Ajuda a entender quais telas precisam melhorar, sem venda de dados nem
                  publicidade de terceiros.
                </small>
              </div>
              <label className="checkbox" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={analyticsDraft}
                  onChange={(e) => setAnalyticsDraft(e.target.checked)}
                  aria-label="Autorizar cookies opcionais de medição"
                />
                <span>{analyticsDraft ? 'Ativo' : 'Desativado'}</span>
              </label>
            </div>

            <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
              <button
                type="button"
                className="btn"
                onClick={() => handleSave(false)}
              >
                Recusar opcionais
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => handleSave(analyticsDraft)}
              >
                Salvar preferências
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
