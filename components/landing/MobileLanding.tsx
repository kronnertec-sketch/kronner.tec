'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Link2,
  Wallet,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { openCookieSettings } from '@/lib/consent';
import {
  InteractiveFeatureDemo,
  MobileHeroDashboardPreview,
  type DemoFeatureId,
} from './ProductShowcase';

const MOBILE_FEATURES: Array<{
  id: DemoFeatureId;
  label: string;
  summary: string;
  icon: typeof CalendarDays;
}> = [
  {
    id: 'agenda',
    label: 'Agenda',
    summary: 'Filtre por cadeira, conclua atendimentos e evite atrasos automaticamente.',
    icon: CalendarDays,
  },
  {
    id: 'booking',
    label: 'Link cliente',
    summary: 'Seu cliente escolhe serviço e horário real pelo link da bio.',
    icon: Link2,
  },
  {
    id: 'finance',
    label: 'Financeiro',
    summary: 'Caixa líquido com taxas de cartão e saldo de comissão por barbeiro.',
    icon: Wallet,
  },
  {
    id: 'holidays',
    label: 'Feriados',
    summary: 'Aviso automático pelo CEP para abrir ou fechar a agenda em um toque.',
    icon: Bell,
  },
];

const MOB_STATEMENT_WORDS: Array<{ text: string; tone?: 'brass' }> = [
  { text: 'Menos' },
  { text: 'tempo' },
  { text: 'respondendo' },
  { text: 'WhatsApp.' },
  { text: 'Mais' },
  { text: 'cadeiras' },
  { text: 'cheias' },
  { text: 'e' },
  { text: 'caixa' },
  { text: 'fechado' },
  { text: 'sem' },
  { text: 'planilha.', tone: 'brass' },
];

export function MobileLanding() {
  const [activeFeature, setActiveFeature] = useState<DemoFeatureId>('agenda');
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [statementProgress, setStatementProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const heroCtaRef = useRef<HTMLDivElement | null>(null);
  const statementRef = useRef<HTMLElement | null>(null);
  const revealRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const revealObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.16, rootMargin: '0px 0px -12% 0px' }
    );
    revealRefs.current.forEach(el => {
      if (el) revealObserver.observe(el);
    });

    const ctaObserver = new IntersectionObserver(
      ([entry]) => setShowStickyCta(!entry.isIntersecting),
      { threshold: 0 }
    );
    if (heroCtaRef.current) ctaObserver.observe(heroCtaRef.current);

    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? Math.max(0, Math.min(1, window.scrollY / docHeight)) : 0);

      const el = statementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = (vh * 0.86 - rect.top) / (vh * 0.52);
      setStatementProgress(Math.max(0, Math.min(1, raw)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      revealObserver.disconnect();
      ctaObserver.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const currentFeature = MOBILE_FEATURES.find(f => f.id === activeFeature) || MOBILE_FEATURES[0];

  return (
    <div className="kl2-mobile">
      <div
        className="kl2-scroll-progress"
        style={{ transform: `scaleX(${scrollProgress})` }}
        aria-hidden="true"
      />
      <header className="kl2-mob-header">
        <Link href="/" className="kl2-nav-brand" aria-label="Kronner">
          <BrandLogo variant="dark" height={24} />
        </Link>
        <div className="kl2-mob-header-actions">
          <Link href="/entrar" className="kl2-btn kl2-btn-ghost kl2-btn-sm">
            Entrar
          </Link>
        </div>
      </header>

      <main>
        {/* MOBILE HERO (BARBER PHOTO ABOVE THE FOLD) */}
        <section className="kl2-mob-hero" aria-labelledby="kl2-mob-hero-title">
          <div className="kl2-hero-photo-wrap kl2-mob-hero-photo-wrap kl2-enter kl2-d1">
            <div className="kl2-photo-frame kl2-mob-hero-photo">
              <img
                src="/images/barber-craft.jpg"
                alt="Barbeiro realizando corte degradê com precisão em barbearia moderna"
                decoding="async"
              />
            </div>
            <div className="kl2-hero-float-pill is-mobile" aria-hidden="true">
              <i className="kl2-live-dot" />
              <span><b>14:50</b> · Corte degradê · Confirmado</span>
            </div>
          </div>

          <h1 id="kl2-mob-hero-title" className="kl2-enter kl2-d2">
            Sua barbearia no ritmo certo.
          </h1>
          <p className="kl2-mob-sub kl2-enter kl2-d3">
            Agenda por cadeira, link para o cliente agendar sozinho e financeiro com comissões. 15
            dias grátis sem cartão.
          </p>

          <div ref={heroCtaRef} className="kl2-mob-hero-actions kl2-enter kl2-d3">
            <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-block">
              Começar 15 dias grátis <ArrowRight size={16} />
            </Link>
          </div>

          <div className="kl2-mob-hero-stage kl2-enter kl2-d4">
            <MobileHeroDashboardPreview />
          </div>
        </section>

        {/* MOBILE INTERACTIVE SHOWCASE */}
        <section
          className="kl2-mob-section kl2-reveal"
          ref={el => {
            revealRefs.current[0] = el;
          }}
          aria-labelledby="kl2-mob-showcase-title"
        >
          <h2 id="kl2-mob-showcase-title" className="kl2-mask-reveal">Toque e teste o sistema agora.</h2>

          <div className="kl2-mob-pills kl2-stagger" style={{ transitionDelay: '120ms' }} role="tablist" aria-label="Principais funções">
            {MOBILE_FEATURES.map(item => {
              const Icon = item.icon;
              const active = activeFeature === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`kl2-mob-pill ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveFeature(item.id)}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <p className="kl2-mob-feature-note">{currentFeature.summary}</p>

          <div className="kl2-showcase-stage" key={activeFeature}>
            <InteractiveFeatureDemo feature={activeFeature} />
          </div>
        </section>

        {/* MOBILE EMERALD STATEMENT + BARBERSHOP STATION PHOTO */}
        <section
          ref={el => {
            statementRef.current = el;
            revealRefs.current[1] = el;
          }}
          className="kl2-mob-statement kl2-reveal"
          aria-label="Proposta da Kronner"
        >
          <div className="kl2-photo-frame kl2-mob-photo kl2-stagger">
            <img
              src="/images/barbershop-station.jpg"
              alt="Cadeira de barbearia clássica em ambiente moderno e organizado"
              loading="lazy"
              decoding="async"
            />
          </div>
          <p>
            {MOB_STATEMENT_WORDS.map((word, idx) => {
              const threshold = idx / MOB_STATEMENT_WORDS.length;
              const lit = statementProgress >= threshold * 0.88;
              return (
                <span
                  key={idx}
                  className={`kl2-word ${lit ? 'is-lit' : ''} ${word.tone === 'brass' ? 'is-brass' : ''}`}
                >
                  {word.text}{' '}
                </span>
              );
            })}
          </p>
        </section>

        {/* MOBILE PRICING */}
        <section
          className="kl2-mob-section kl2-reveal"
          ref={el => {
            revealRefs.current[2] = el;
          }}
          aria-labelledby="kl2-mob-pricing-title"
        >
          <h2 id="kl2-mob-pricing-title" className="kl2-mask-reveal">Preço direto, sem surpresa.</h2>

          <div className="kl2-pricing-card kl2-mob-pricing-card kl2-stagger" style={{ transitionDelay: '140ms' }}>
            <div className="kl2-price-tag">
              <strong>R$ 99,90</strong>
              <span>/mês · 1 cadeira completa</span>
            </div>

            <div className="kl2-price-seat">
              <span>Cadeira adicional</span>
              <b>+ R$ 35,90/mês</b>
            </div>

            <ul className="kl2-price-list">
              <li><Check size={15} /> Agenda por cadeira e intervalo automático</li>
              <li><Check size={15} /> Link público fixo na bio</li>
              <li><Check size={15} /> Financeiro de serviços, comissões e mensalistas</li>
              <li><Check size={15} /> Feriados pelo CEP · 15 dias grátis sem cartão</li>
            </ul>

            <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-block">
              Começar 15 dias grátis <ArrowRight size={16} />
            </Link>
            <Link href="/entrar" className="kl2-btn kl2-btn-outline kl2-btn-block">
              Entrar na minha conta
            </Link>
          </div>
        </section>
      </main>

      <footer className="kl2-mob-footer">
        <BrandLogo variant="dark" height={22} />
        <p>kronner.tec@gmail.com</p>
        <nav className="kl2-mob-footer-links" aria-label="Links institucionais">
          <Link href="/meus-horarios">Meus horários</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/termos">Termos</Link>
          <Link href="/reembolso">Reembolso</Link>
          <Link href="/cookies">Cookies</Link>
          <button type="button" className="kl2-footer-btn" onClick={openCookieSettings}>
            Cookies (config.)
          </button>
        </nav>
      </footer>

      {/* STICKY THUMB CONVERSION BAR */}
      <div className={`kl2-mob-sticky ${showStickyCta ? 'is-visible' : ''}`}>
        <div>
          <strong>15 dias grátis</strong>
          <small>Sem cartão de crédito</small>
        </div>
        <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-sm">
          Testar agora <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
