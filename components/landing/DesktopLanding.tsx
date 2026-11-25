'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock,
  Link2,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { openCookieSettings } from '@/lib/consent';
import {
  HeroDashboardPreview,
  InteractiveFeatureDemo,
  type DemoFeatureId,
} from './ProductShowcase';

const FEATURES: Array<{
  id: DemoFeatureId;
  title: string;
  summary: string;
  icon: typeof CalendarDays;
}> = [
  {
    id: 'agenda',
    title: 'Agenda por cadeira',
    summary: 'Filtre por profissional, conclua atendimentos e evite atrasos com intervalo automático.',
    icon: CalendarDays,
  },
  {
    id: 'booking',
    title: 'Link público na bio',
    summary: 'O cliente escolhe serviço e horário real sem trocar dez mensagens no WhatsApp.',
    icon: Link2,
  },
  {
    id: 'finance',
    title: 'Financeiro e comissões',
    summary: 'Taxas de cartão descontadas na hora e saldo de comissão pronto por barbeiro.',
    icon: Wallet,
  },
  {
    id: 'holidays',
    title: 'Feriados pelo CEP',
    summary: 'Aviso automático antes do feriado para abrir ou fechar a agenda em um toque.',
    icon: Bell,
  },
];

const STATEMENT_WORDS: Array<{ text: string; tone?: 'brass' }> = [
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

export function DesktopLanding() {
  const [activeFeature, setActiveFeature] = useState<DemoFeatureId>('agenda');
  const [statementProgress, setStatementProgress] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [navScrolled, setNavScrolled] = useState(false);
  const [heroParallax, setHeroParallax] = useState(0);
  const statementRef = useRef<HTMLElement | null>(null);
  const revealRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -14% 0px' }
    );

    revealRefs.current.forEach(el => {
      if (el) observer.observe(el);
    });

    const onScroll = () => {
      const scrollY = window.scrollY;
      setNavScrolled(scrollY > 24);
      setHeroParallax(Math.min(20, scrollY * 0.04));
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? Math.max(0, Math.min(1, scrollY / docHeight)) : 0);

      const el = statementRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = (vh * 0.84 - rect.top) / (vh * 0.56);
      setStatementProgress(Math.max(0, Math.min(1, raw)));
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="kl2-desktop">
      <div
        className="kl2-scroll-progress"
        style={{ transform: `scaleX(${scrollProgress})` }}
        aria-hidden="true"
      />
      <a className="kl-skip" href="#conteudo-desktop">
        Ir para o conteúdo principal
      </a>

      <header className="kl2-nav-wrap">
        <div className={`kl2-wrap kl2-nav ${navScrolled ? 'is-scrolled' : ''}`}>
          <Link href="/" className="kl2-nav-brand" aria-label="Kronner">
            <BrandLogo variant="dark" height={28} />
          </Link>

          <nav className="kl2-nav-links" aria-label="Navegação principal">
            <a href="#sistema">Sistema</a>
            <a href="#planos">Planos</a>
            <Link href="/meus-horarios">Meus horários</Link>
          </nav>

          <div className="kl2-nav-actions">
            <Link href="/entrar" className="kl2-btn kl2-btn-ghost">
              Entrar
            </Link>
            <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary">
              Começar 15 dias grátis <ArrowRight size={14} className="kl2-btn-arrow" />
            </Link>
          </div>
        </div>
      </header>

      <main id="conteudo-desktop">
        {/* SCREEN 1: HERO (BARBER PHOTO ABOVE THE FOLD + REAL STATIC DASHBOARD) */}
        <section className="kl2-hero" aria-labelledby="kl2-hero-title">
          <div className="kl2-wrap">
            <div className="kl2-hero-split">
              <div className="kl2-hero-copy">
                <h1 id="kl2-hero-title" className="kl2-enter kl2-d1">
                  Sua barbearia no ritmo certo.
                </h1>
                <p className="kl2-hero-sub kl2-enter kl2-d2">
                  Agenda por cadeira, link para o cliente agendar sozinho e financeiro com comissões
                  em um painel feito para o dia a dia da barbearia. 15 dias grátis sem cartão.
                </p>
                <div className="kl2-hero-actions kl2-enter kl2-d3">
                  <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-cta kl2-btn-lg">
                    Começar 15 dias grátis <ArrowRight size={16} className="kl2-btn-arrow" />
                  </Link>
                  <a href="#sistema" className="kl2-btn kl2-btn-outline kl2-btn-lg">
                    Testar o sistema abaixo
                  </a>
                </div>
                <p className="kl2-cta-reassurance kl2-enter kl2-d3">
                  <span><Check size={13} /> Sem cartão de crédito</span>
                  <span><Check size={13} /> Configura em 2 min</span>
                  <span><Check size={13} /> Cancele quando quiser</span>
                </p>
              </div>

              <div className="kl2-hero-photo-wrap kl2-enter kl2-d3">
                <div className="kl2-photo-frame kl2-hero-photo">
                  <img
                    src="/images/barber-craft.jpg"
                    alt="Barbeiro realizando corte degradê com precisão em barbearia moderna"
                    decoding="async"
                  />
                </div>
                <div className="kl2-hero-float-pill" aria-hidden="true">
                  <i className="kl2-live-dot" />
                  <span><b>14:50</b> · Corte degradê · Confirmado</span>
                </div>
              </div>
            </div>

            <div className="kl2-hero-stage kl2-enter kl2-d4">
              <div style={{ transform: `translate3d(0, ${-heroParallax}px, 0)`, willChange: 'transform' }}>
                <HeroDashboardPreview />
              </div>
            </div>
          </div>
        </section>

        {/* SCREEN 2: INTERACTIVE PRODUCT SHOWCASE */}
        <section
          id="sistema"
          className="kl2-section kl2-reveal"
          ref={el => {
            revealRefs.current[0] = el;
          }}
          aria-labelledby="kl2-showcase-title"
        >
          <div className="kl2-wrap">
            <div className="kl2-section-head">
              <h2 id="kl2-showcase-title" className="kl2-mask-reveal">Veja por dentro antes de criar conta.</h2>
              <p className="kl2-stagger" style={{ transitionDelay: '120ms' }}>Clique nos recursos à esquerda e interaja com as telas reais da Kronner.</p>
            </div>

            <div className="kl2-showcase-grid">
              <div className="kl2-feature-rail" role="tablist" aria-label="Principais funções">
                {FEATURES.map((item, idx) => {
                  const Icon = item.icon;
                  const active = activeFeature === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`kl2-feature-item kl2-from-left ${active ? 'is-active' : ''}`}
                      style={{ transitionDelay: `${120 + idx * 90}ms` }}
                      onClick={() => setActiveFeature(item.id)}
                    >
                      <span className="kl2-feature-icon">
                        <Icon size={18} />
                      </span>
                      <span className="kl2-feature-text">
                        <strong>{item.title}</strong>
                        <small>{item.summary}</small>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="kl2-from-right" style={{ transitionDelay: '220ms' }}>
                <div className="kl2-showcase-stage" key={activeFeature}>
                  <InteractiveFeatureDemo feature={activeFeature} />
                </div>
              </div>
            </div>

            <div className="kl2-showcase-cta kl2-stagger" style={{ transitionDelay: '260ms' }}>
              <div>
                <strong>Curtiu o painel por dentro?</strong>
                <span>Teste na sua barbearia por 15 dias sem cadastrar cartão.</span>
              </div>
              <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-cta">
                Criar minha conta grátis <ArrowRight size={15} className="kl2-btn-arrow" />
              </Link>
            </div>
          </div>
        </section>

        {/* SCREEN 3: EDITORIAL SCROLL-REVEAL STATEMENT + BARBER PHOTO */}
        <section
          ref={el => {
            statementRef.current = el;
            revealRefs.current[2] = el;
          }}
          className="kl2-statement kl2-reveal"
          aria-label="Proposta da Kronner"
        >
          <div className="kl2-wrap kl2-statement-grid">
            <div className="kl2-statement-copy">
              <p className="kl2-statement-text">
                {STATEMENT_WORDS.map((word, idx) => {
                  const threshold = idx / STATEMENT_WORDS.length;
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
              <div className="kl2-statement-actions">
                <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-light kl2-btn-lg">
                  Começar 15 dias grátis <ArrowRight size={16} className="kl2-btn-arrow" />
                </Link>
                <span className="kl2-statement-note">Sem cartão · Liberação imediata</span>
              </div>
            </div>
            <div className="kl2-photo-frame kl2-from-right" style={{ transitionDelay: '160ms' }}>
              <img
                src="/images/barbershop-station.jpg"
                alt="Cadeira de barbearia clássica em ambiente moderno e organizado"
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </section>

        {/* SCREEN 4: TRANSPARENT PRICING & CLOSING CTA */}
        <section
          id="planos"
          className="kl2-section kl2-reveal"
          ref={el => {
            revealRefs.current[1] = el;
          }}
          aria-labelledby="kl2-pricing-title"
        >
          <div className="kl2-wrap kl2-pricing-grid">
            <div className="kl2-pricing-copy">
              <h2 id="kl2-pricing-title" className="kl2-mask-reveal">Preço direto para o tamanho da sua barbearia.</h2>
              <p className="kl2-from-left" style={{ transitionDelay: '100ms' }}>
                Comece hoje sem cadastrar cartão. Quando sua equipe crescer, adicione novas cadeiras
                pelas configurações com valor proporcional.
              </p>
              <ul className="kl2-trust-list">
                <li className="kl2-from-left" style={{ transitionDelay: '180ms' }}>
                  <Clock size={16} /> Configuração guiada em poucos minutos
                </li>
                <li className="kl2-from-left" style={{ transitionDelay: '260ms' }}>
                  <ShieldCheck size={16} /> Acesso individual para sócios e colaboradores
                </li>
                <li className="kl2-from-left" style={{ transitionDelay: '340ms' }}>
                  <Check size={16} /> Cancele quando quiser, sem multa
                </li>
              </ul>
            </div>

            <div className="kl2-pricing-card kl2-from-right" style={{ transitionDelay: '180ms' }}>
              <div className="kl2-pricing-head">
                <div>
                  <h3>Plano Principal</h3>
                  <p>1 cadeira completa com todos os módulos liberados.</p>
                </div>
                <div className="kl2-price-tag">
                  <strong>R$ 99,90</strong>
                  <span>/mês</span>
                </div>
              </div>

              <div className="kl2-price-seat">
                <span>Cadeira adicional (sócio ou funcionário)</span>
                <b>+ R$ 35,90/mês</b>
              </div>

              <ul className="kl2-price-list">
                <li><Check size={15} /> Agenda por cadeira com intervalo de segurança</li>
                <li><Check size={15} /> Link público fixo para clientes agendarem sozinhos</li>
                <li><Check size={15} /> Financeiro de serviços, comissões e mensalistas</li>
                <li><Check size={15} /> Feriados nacionais, estaduais e municipais pelo CEP</li>
              </ul>

              <div className="kl2-price-actions">
                <Link href="/entrar?mode=signup" className="kl2-btn kl2-btn-primary kl2-btn-cta kl2-btn-block">
                  Começar 15 dias grátis <ArrowRight size={16} className="kl2-btn-arrow" />
                </Link>
                <p className="kl2-price-signin">
                  Sem cartão de crédito · Já tem conta?{' '}
                  <Link href="/entrar">Entrar no painel</Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="kl2-footer">
        <div className="kl2-wrap kl2-footer-inner">
          <div className="kl2-footer-brand">
            <BrandLogo variant="dark" height={24} />
            <span>Tempo para o seu talento · kronner.tec@gmail.com</span>
          </div>
          <nav className="kl2-footer-links" aria-label="Links institucionais">
            <Link href="/entrar">Painel</Link>
            <Link href="/meus-horarios">Meus horários</Link>
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/termos">Termos</Link>
            <Link href="/reembolso">Reembolso</Link>
            <Link href="/cookies">Cookies</Link>
            <button type="button" className="kl2-footer-btn" onClick={openCookieSettings}>
              Preferências de cookies
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
