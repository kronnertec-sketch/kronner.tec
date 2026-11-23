'use client';

import Link from 'next/link';
import { ArrowLeft, Cookie } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { openCookieSettings } from '@/lib/consent';

type LegalShellProps = {
  title: string;
  subtitle: string;
  updatedAt: string;
  current: 'privacidade' | 'termos' | 'reembolso' | 'cookies';
  children: React.ReactNode;
};

export function LegalShell({
  title,
  subtitle,
  updatedAt,
  current,
  children,
}: LegalShellProps) {
  return (
    <div className="legal-page">
      <a className="kl-skip" href="#conteudo-legal">
        Ir para o conteúdo principal
      </a>

      <header className="legal-header">
        <div className="legal-wrap legal-header-inner">
          <Link href="/" className="brand" aria-label="Kronner página inicial">
            <BrandLogo variant="light" height={30} />
          </Link>
          <Link href="/" className="auth-back-link">
            <ArrowLeft size={14} aria-hidden="true" /> Voltar ao início
          </Link>
        </div>
      </header>

      <section className="legal-hero">
        <div className="legal-wrap">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          <small className="legal-updated">Última atualização: {updatedAt}</small>
        </div>
      </section>

      <main id="conteudo-legal" className="legal-wrap legal-content">
        <article className="card legal-article">{children}</article>
      </main>

      <footer className="legal-footer">
        <div className="legal-wrap legal-footer-inner">
          <nav className="legal-nav-links" aria-label="Documentos legais">
            <Link
              href="/privacidade"
              aria-current={current === 'privacidade' ? 'page' : undefined}
            >
              Privacidade (LGPD)
            </Link>
            <Link href="/termos" aria-current={current === 'termos' ? 'page' : undefined}>
              Termos de Serviço
            </Link>
            <Link
              href="/reembolso"
              aria-current={current === 'reembolso' ? 'page' : undefined}
            >
              Reembolso
            </Link>
            <Link href="/cookies" aria-current={current === 'cookies' ? 'page' : undefined}>
              Cookies
            </Link>
            <button type="button" className="text-btn" onClick={openCookieSettings}>
              <Cookie size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Preferências de cookies
            </button>
          </nav>
          <small>Contato de privacidade e suporte: kronner.tec@gmail.com</small>
        </div>
      </footer>
    </div>
  );
}
