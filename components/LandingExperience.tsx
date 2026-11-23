'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  Clock,
  Coffee,
  CreditCard,
  Link2,
  MapPin,
  Scissors,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { openCookieSettings } from '@/lib/consent';

type Chapter = {
  id: string;
  tag: string;
  title: string;
  body: string;
  detail: string;
  accent: 'emerald' | 'brass';
};

const CHAPTERS: Chapter[] = [
  {
    id: 'agenda',
    tag: 'Agenda por cadeira',
    title: 'Horários que respeitam o ritmo da cadeira.',
    body: 'Visualize o dia, a semana ou o mês de toda a equipe ou filtre por profissional. Configure intervalo de segurança automático entre atendimentos e bloqueie pausas sem sobrepor clientes.',
    detail: 'Timeline ao vivo com detalhe lateral, status e atalho para WhatsApp',
    accent: 'emerald',
  },
  {
    id: 'link',
    tag: 'Link público',
    title: 'Um link na bio. Menos mensagens para responder.',
    body: 'Seu cliente abre o endereço da sua barbearia, seleciona corte, barba ou combo, escolhe manhã, tarde ou noite e reserva apenas os horários em que o atendimento inteiro cabe.',
    detail: 'Uma conta única do cliente funciona em todas as barbearias na Kronner',
    accent: 'brass',
  },
  {
    id: 'feriados',
    tag: 'Feriados pelo CEP',
    title: 'Feriados da sua cidade resolvidos antes da semana virar.',
    body: 'Ao informar o CEP da barbearia, a Kronner acompanha feriados nacionais, estaduais e municipais e avisa com antecedência. Em um clique você define se vai trabalhar ou fechar a agenda.',
    detail: 'Você pode alterar sua decisão na aba de Avisos quando precisar',
    accent: 'emerald',
  },
  {
    id: 'caixa',
    tag: 'Caixa e PDV',
    title: 'Cada entrada, taxa e comissão no lugar certo.',
    body: 'Registre pagamentos em Pix, dinheiro, crédito ou débito com taxas configuradas, venda produtos no balcão, acompanhe comissões da equipe e imprima o relatório financeiro em PDF.',
    detail: 'Fechamento diário de caixa, estornos e controle de mensalistas integrados',
    accent: 'brass',
  },
];

const STATEMENT_WORDS: Array<{ text: string; tone?: 'emerald' | 'brass' }> = [
  { text: 'Enquanto' },
  { text: 'você' },
  { text: 'foca' },
  { text: 'no' },
  { text: 'acabamento' },
  { text: 'perfeito,' },
  { text: 'a' },
  { text: 'Kronner', tone: 'emerald' },
  { text: 'organiza' },
  { text: 'cada' },
  { text: 'cadeira,' },
  { text: 'cada' },
  { text: 'encaixe,' },
  { text: 'cada' },
  { text: 'feriado' },
  { text: 'e' },
  { text: 'cada' },
  { text: 'centavo', tone: 'brass' },
  { text: 'do' },
  { text: 'seu' },
  { text: 'caixa.' },
];

function ChapterMorphEmblem({
  activeIndex,
  progress,
}: {
  activeIndex: number;
  progress: number;
}) {
  const circumference = 2 * Math.PI * 30;
  const clamped = Math.max(0.08, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const accentColor = activeIndex % 2 === 0 ? '#1EC28F' : '#E2AA4F';

  return (
    <div className="kl-emblem-shell" aria-hidden="true">
      <svg className="kl-emblem-ring" viewBox="0 0 72 72" width="72" height="72">
        <circle
          cx="36"
          cy="36"
          r="30"
          fill="none"
          stroke="rgba(242,245,243,0.12)"
          strokeWidth="2.5"
        />
        <circle
          cx="36"
          cy="36"
          r="30"
          fill="none"
          stroke={accentColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 36 36)"
          style={{
            transition:
              'stroke-dashoffset 220ms var(--ease-out), stroke 260ms var(--ease-out)',
          }}
        />
      </svg>

      <div className="kl-emblem-icons">
        {[CalendarDays, Link2, MapPin, Wallet].map((Icon, idx) => (
          <span
            key={idx}
            className={`kl-emblem-glyph ${activeIndex === idx ? 'is-active' : ''}`}
            style={{ color: idx % 2 === 0 ? '#1EC28F' : '#E2AA4F' }}
          >
            <Icon size={24} strokeWidth={1.85} />
          </span>
        ))}
      </div>
    </div>
  );
}

function StageScene({
  index,
  holidayChoice,
  onHolidayChoice,
}: {
  index: number;
  holidayChoice: 'open' | 'closed';
  onHolidayChoice: (choice: 'open' | 'closed') => void;
}) {
  if (index === 0) {
    return (
      <div className="kl-scene-body">
        <div className="kl-scene-topbar">
          <span className="kl-scene-pill is-emerald">
            <CalendarDays size={13} /> Quinta · 19 de novembro
          </span>
          <span className="kl-scene-meta">3 cadeiras ativas</span>
        </div>
        <div className="kl-scene-timeline">
          <div className="kl-slot-row is-done">
            <span className="kl-slot-time">09:30</span>
            <div className="kl-slot-card">
              <div>
                <strong>Lucas Andrade</strong>
                <small>Corte degradê + acabamento · 40 min</small>
              </div>
              <span className="kl-chip green">Concluído</span>
            </div>
          </div>
          <div className="kl-slot-buffer">
            <span className="kl-slot-time muted">10:10</span>
            <div className="kl-buffer-bar">
              <Coffee size={13} /> Intervalo de segurança · 10 min
            </div>
          </div>
          <div className="kl-slot-row is-focus">
            <span className="kl-slot-time">10:20</span>
            <div className="kl-slot-card">
              <div>
                <strong>Rafael Mendes</strong>
                <small>Corte + Barba terapia · 60 min · Cadeira 1</small>
              </div>
              <span className="kl-chip emerald">Agendado</span>
            </div>
          </div>
          <div className="kl-slot-row">
            <span className="kl-slot-time">11:30</span>
            <div className="kl-slot-card">
              <div>
                <strong>Henrique Costa</strong>
                <small>Plano mensalista · 35 min</small>
              </div>
              <span className="kl-chip brass">Mensalista</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (index === 1) {
    return (
      <div className="kl-scene-body">
        <div className="kl-scene-topbar">
          <span className="kl-scene-url">kronner.vercel.app/b/atelier-centro</span>
          <span className="kl-scene-pill is-brass">
            <Scissors size={13} /> Link ativo
          </span>
        </div>
        <div className="kl-booking-preview">
          <div className="kl-booking-services">
            <div className="kl-srv-item is-checked">
              <span className="kl-srv-box">
                <Check size={12} />
              </span>
              <div>
                <strong>Corte social ou degradê</strong>
                <small>40 minutos</small>
              </div>
              <b>R$ 55,00</b>
            </div>
            <div className="kl-srv-item is-checked">
              <span className="kl-srv-box">
                <Check size={12} />
              </span>
              <div>
                <strong>Barba com toalha quente</strong>
                <small>25 minutos</small>
              </div>
              <b>R$ 40,00</b>
            </div>
          </div>
          <div className="kl-booking-slots-preview">
            <span className="kl-mini-label">Tarde · 65 min disponíveis</span>
            <div className="kl-mini-slot-row">
              <span>14:00</span>
              <span className="is-picked">15:15</span>
              <span>16:30</span>
              <span>17:45</span>
            </div>
          </div>
          <div className="kl-booking-total-bar">
            <div>
              <small>Total · 65 min</small>
              <strong>R$ 95,00</strong>
            </div>
            <span className="kl-fake-cta">
              Confirmar horário <ArrowRight size={14} />
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (index === 2) {
    return (
      <div className="kl-scene-body">
        <div className="kl-scene-topbar">
          <span className="kl-scene-pill is-emerald">
            <MapPin size={13} /> CEP 38400-100 · Uberlândia / MG
          </span>
          <span className="kl-scene-meta">Central de avisos</span>
        </div>
        <div className="kl-holiday-card">
          <div className="kl-holiday-head">
            <span className="kl-holiday-icon">
              <Bell size={18} />
            </span>
            <div>
              <strong>Feriado nas próximas duas semanas</strong>
              <p>Consciência Negra · 20/11 · Feriado Nacional</p>
            </div>
          </div>
          <div className="kl-holiday-status">
            {holidayChoice === 'open'
              ? 'Agenda aberta normalmente nesta data. Você pode mudar de ideia quando quiser.'
              : 'Agenda bloqueada no link público para este feriado.'}
          </div>
          <div className="kl-holiday-actions">
            <button
              type="button"
              className={`kl-choice-btn ${holidayChoice === 'open' ? 'is-selected' : ''}`}
              onClick={() => onHolidayChoice('open')}
            >
              {holidayChoice === 'open' && <Check size={14} />} Vou trabalhar
            </button>
            <button
              type="button"
              className={`kl-choice-btn ${holidayChoice === 'closed' ? 'is-selected' : ''}`}
              onClick={() => onHolidayChoice('closed')}
            >
              {holidayChoice === 'closed' && <Check size={14} />} Não vou trabalhar
            </button>
          </div>
        </div>
        <div className="kl-holiday-footnote">
          <ShieldCheck size={14} />
          <span>Sem spam de pop-up: sua escolha fica salva nos Avisos.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="kl-scene-body">
      <div className="kl-scene-topbar">
        <span className="kl-scene-pill is-brass">
          <Wallet size={13} /> Fechamento do dia
        </span>
        <span className="kl-scene-meta">PDV + Comissões</span>
      </div>
      <div className="kl-ledger-grid">
        <div className="kl-ledger-kpi">
          <small>Entradas líquidas</small>
          <strong>R$ 1.240,00</strong>
          <span>Pix e dinheiro sem taxa</span>
        </div>
        <div className="kl-ledger-kpi">
          <small>Produtos no balcão</small>
          <strong>R$ 185,00</strong>
          <span>Pomada + óleo · estoque ok</span>
        </div>
      </div>
      <div className="kl-ledger-rows">
        <div className="kl-ledger-row">
          <span>
            <CreditCard size={14} /> Pix · 8 atendimentos
          </span>
          <b>R$ 740,00</b>
        </div>
        <div className="kl-ledger-row">
          <span>
            <CreditCard size={14} /> Crédito / Débito (líquido)
          </span>
          <b>R$ 495,00</b>
        </div>
        <div className="kl-ledger-row is-highlight">
          <span>
            <Users size={14} /> Comissões apuradas
          </span>
          <b>R$ 412,00</b>
        </div>
      </div>
    </div>
  );
}

export default function LandingExperience() {
  const [heroTab, setHeroTab] = useState<'agenda' | 'cliente'>('agenda');
  const [activeChapter, setActiveChapter] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0.15);
  const [statementProgress, setStatementProgress] = useState(0);
  const [holidayChoice, setHolidayChoice] = useState<'open' | 'closed'>('open');
  const [navScrolled, setNavScrolled] = useState(false);

  const chapterRefs = useRef<Array<HTMLElement | null>>([]);
  const chaptersSectionRef = useRef<HTMLElement | null>(null);
  const statementRef = useRef<HTMLElement | null>(null);
  const pricingCardRef = useRef<HTMLDivElement | null>(null);

  const handlePricingPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || !pricingCardRef.current) return;
    const rect = pricingCardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pricingCardRef.current.style.setProperty('--mx', `${x}px`);
    pricingCardRef.current.style.setProperty('--my', `${y}px`);
    pricingCardRef.current.setAttribute('data-spotlight', 'on');
  };

  const handlePricingPointerLeave = () => {
    pricingCardRef.current?.removeAttribute('data-spotlight');
  };

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (
      q.has('code') ||
      q.has('error') ||
      location.hash.includes('access_token=') ||
      location.hash.includes('error=')
    ) {
      location.replace('/auth/retorno' + location.search + location.hash);
    }
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setStatementProgress(1);
    }

    let rafId = 0;

    const updateOnScroll = () => {
      rafId = 0;
      setNavScrolled(window.scrollY > 24);

      const sectionEl = chaptersSectionRef.current;
      if (sectionEl) {
        const rect = sectionEl.getBoundingClientRect();
        const scrollable = Math.max(1, rect.height - window.innerHeight * 0.72);
        const raw = (-rect.top + window.innerHeight * 0.22) / scrollable;
        const clamped = Math.max(0, Math.min(1, raw));
        setScrollProgress(clamped);

        const targetCenter = window.innerHeight * 0.42;
        let closestIdx = 0;
        let closestDist = Number.POSITIVE_INFINITY;
        chapterRefs.current.forEach((el, idx) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          const mid = r.top + r.height * 0.4;
          const dist = Math.abs(mid - targetCenter);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = idx;
          }
        });
        setActiveChapter(closestIdx);
      }

      if (!reduced && statementRef.current) {
        const sr = statementRef.current.getBoundingClientRect();
        const start = window.innerHeight * 0.85;
        const end = window.innerHeight * 0.2;
        const sp = (start - sr.top) / Math.max(1, start - end);
        setStatementProgress(Math.max(0, Math.min(1, sp)));
      }
    };

    const onScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(updateOnScroll);
      }
    };

    updateOnScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const jumpToChapter = (idx: number) => {
    setActiveChapter(idx);
    const target = chapterRefs.current[idx];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="kroner-landing">
      <a className="kl-skip" href="#conteudo-principal">
        Ir para o conteúdo principal
      </a>

      <header className={`kl-nav ${navScrolled ? 'is-scrolled' : ''}`}>
        <div className="kl-wrap kl-nav-inner">
          <Link href="/" className="kl-brand-link" aria-label="Kronner início">
            <BrandLogo variant="light" height={31} />
          </Link>

          <nav className="kl-nav-links" aria-label="Navegação principal">
            <a href="#como-funciona">Como funciona</a>
            <a href="#dois-lados">Barbearia e cliente</a>
            <a href="#planos">Planos</a>
          </nav>

          <div className="kl-nav-actions">
            <Link className="kl-nav-ghost" href="/meus-horarios">
              Meus horários
            </Link>
            <Link className="kl-btn kl-btn-primary" href="/entrar">
              Acessar painel <ArrowRight size={15} className="kl-arrow" />
            </Link>
          </div>
        </div>
      </header>

      <main id="conteudo-principal">
        {/* HERO — Obsidian Carbon Studio */}
        <section className="kl-hero" aria-labelledby="hero-heading">
          <div className="kl-hero-ambient" aria-hidden="true" />
          <div className="kl-wrap kl-hero-grid">
            <div className="kl-hero-copy">
              <h1 id="hero-heading" className="kl-hero-title">
                <span className="kl-line-mask">
                  <span className="kl-line kl-line-1">Seu talento na cadeira.</span>
                </span>
                <span className="kl-line-mask">
                  <span className="kl-line kl-line-2">
                    Sua barbearia em <em>ordem.</em>
                  </span>
                </span>
              </h1>

              <p className="kl-hero-lead">
                Agenda por cadeira, link público para clientes, feriados da sua cidade pelo CEP e
                caixa com PDV em um único comando feito para o ritmo real da barbearia.
              </p>

              <div className="kl-hero-cta-row">
                <Link className="kl-btn kl-btn-primary kl-btn-lg" href="/entrar?mode=signup">
                  Testar 15 dias grátis <ArrowRight size={16} className="kl-arrow" />
                </Link>
                <Link className="kl-btn kl-btn-secondary kl-btn-lg" href="/entrar">
                  Já tenho conta
                </Link>
              </div>

              <div className="kl-hero-facts">
                <span>
                  <Check size={14} /> 15 dias grátis sem cartão
                </span>
                <span>
                  <Check size={14} /> R$ 99,90/mês com 1 cadeira
                </span>
                <span>
                  <Check size={14} /> + R$ 35,90 por cadeira extra
                </span>
              </div>
            </div>

            {/* Live Interactive Kronner Command Preview */}
            <div
              className="kl-hero-stage"
              role="region"
              aria-label="Exemplo ilustrativo da interface do painel e do link de agendamento da Kronner"
            >
              <div className="kl-stage-depth-plate" aria-hidden="true" />
              <div className="kl-app-frame">
                <div className="kl-app-chrome">
                  <div className="kl-chrome-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="kl-hero-switcher" role="tablist" aria-label="Visualização do sistema">
                    <span
                      className="kl-switcher-thumb"
                      style={{
                        transform: heroTab === 'agenda' ? 'translateX(0%)' : 'translateX(100%)',
                      }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroTab === 'agenda'}
                      className={heroTab === 'agenda' ? 'is-active' : ''}
                      onClick={() => setHeroTab('agenda')}
                    >
                      Painel do barbeiro
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroTab === 'cliente'}
                      className={heroTab === 'cliente' ? 'is-active' : ''}
                      onClick={() => setHeroTab('cliente')}
                    >
                      Link do cliente
                    </button>
                  </div>
                </div>

                {heroTab === 'agenda' ? (
                  <div className="kl-app-canvas">
                    <div className="kl-app-kpis">
                      <div className="kl-mini-kpi">
                        <small>Hoje na agenda</small>
                        <strong>11</strong>
                      </div>
                      <div className="kl-mini-kpi">
                        <small>Recebido hoje</small>
                        <strong>R$ 845,00</strong>
                      </div>
                      <div className="kl-mini-kpi is-accent">
                        <small>Concluídos</small>
                        <strong>7</strong>
                      </div>
                    </div>

                    <div className="kl-app-list">
                      <div className="kl-app-row">
                        <time>14:00</time>
                        <div>
                          <strong>Mateus Oliveira</strong>
                          <small>Corte degradê + sobrancelha · 45 min</small>
                        </div>
                        <span className="kl-chip green">Concluído</span>
                      </div>
                      <div className="kl-app-row is-active-row">
                        <time>15:00</time>
                        <div>
                          <strong>Daniel Ferreira</strong>
                          <small>Corte + Barba completa · 60 min</small>
                        </div>
                        <span className="kl-chip emerald">Agora</span>
                      </div>
                      <div className="kl-app-row">
                        <time>16:10</time>
                        <div>
                          <strong>Gustavo Lima</strong>
                          <small>Corte tesoura · Mensalista</small>
                        </div>
                        <span className="kl-chip brass">Agendado</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="kl-app-canvas">
                    <div className="kl-client-header-mock">
                      <div>
                        <strong>Barbearia Dom Pedro</strong>
                        <small>Centro · Uberlândia, MG</small>
                      </div>
                      <span className="kl-chip emerald">Online</span>
                    </div>
                    <div className="kl-client-steps-mock">
                      <span className="is-done">1. Serviços</span>
                      <span className="is-done">2. Período</span>
                      <span className="is-current">3. Horário</span>
                    </div>
                    <div className="kl-client-times-mock">
                      <span>09:30</span>
                      <span>10:30</span>
                      <span className="is-picked">14:15</span>
                      <span>15:30</span>
                      <span>16:45</span>
                      <span>18:00</span>
                    </div>
                    <div className="kl-client-footer-mock">
                      <span>Corte + Barba · 60 min</span>
                      <b>R$ 90,00</b>
                    </div>
                  </div>
                )}
              </div>
              <div className="kl-hero-overlap-pill" aria-hidden="true">
                <span className="kl-overlap-dot" />
                <div>
                  <strong>Feriado detectado pelo CEP</strong>
                  <small>Agenda protegida automaticamente</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CINEMATIC SCROLL-DRIVEN STICKY CHAPTERS */}
        <section
          id="como-funciona"
          ref={chaptersSectionRef}
          className="kl-chapters-section"
          aria-labelledby="chapters-heading"
        >
          <div className="kl-wrap">
            <div className="kl-section-intro">
              <h2 id="chapters-heading">
                Do primeiro cliente da manhã ao fechamento do caixa.
              </h2>
              <p>
                Role pela rotina completa e acompanhe cada peça da Kronner entrando em cena no
                momento em que sua barbearia precisa dela.
              </p>
            </div>

            <div className="kl-chapters-grid">
              {/* Scrolling narrative column */}
              <div className="kl-chapters-list">
                {CHAPTERS.map((chapter, idx) => {
                  const isActive = activeChapter === idx;
                  return (
                    <article
                      key={chapter.id}
                      ref={(el) => {
                        chapterRefs.current[idx] = el;
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                      className={`kl-chapter-item ${isActive ? 'is-active' : ''} accent-${chapter.accent}`}
                      onClick={() => jumpToChapter(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          jumpToChapter(idx);
                        }
                      }}
                    >
                      <div className="kl-chapter-meta">
                        <span className="kl-chapter-tag">{chapter.tag}</span>
                        <span className="kl-chapter-index">
                          {String(idx + 1).padStart(2, '0')} / {String(CHAPTERS.length).padStart(2, '0')}
                        </span>
                      </div>
                      <h3>{chapter.title}</h3>
                      <p>{chapter.body}</p>
                      <div className="kl-chapter-detail">
                        <Sparkles size={14} />
                        <span>{chapter.detail}</span>
                      </div>

                      {/* Mobile inline visual preview so smaller screens stay crystal clear */}
                      <div className="kl-chapter-mobile-stage">
                        <StageScene
                          index={idx}
                          holidayChoice={holidayChoice}
                          onHolidayChoice={setHolidayChoice}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Sticky Morphing Visual Stage (Desktop) */}
              <div className="kl-sticky-column">
                <div className="kl-sticky-stage">
                  <div className="kl-stage-head">
                    <ChapterMorphEmblem
                      activeIndex={activeChapter}
                      progress={scrollProgress}
                    />
                    <div className="kl-stage-head-copy">
                      <span className="kl-stage-counter">
                        {CHAPTERS[activeChapter].tag}
                      </span>
                      <strong>{CHAPTERS[activeChapter].title}</strong>
                    </div>
                  </div>

                  <div className="kl-stage-viewport">
                    {CHAPTERS.map((ch, idx) => (
                      <div
                        key={ch.id}
                        className={`kl-stage-slide ${activeChapter === idx ? 'is-active' : ''}`}
                        aria-hidden={activeChapter !== idx}
                      >
                        <StageScene
                          index={idx}
                          holidayChoice={holidayChoice}
                          onHolidayChoice={setHolidayChoice}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="kl-stage-dock" role="tablist" aria-label="Etapas do sistema">
                    {CHAPTERS.map((ch, idx) => (
                      <button
                        key={ch.id}
                        type="button"
                        role="tab"
                        aria-selected={activeChapter === idx}
                        className={`kl-dock-pill ${activeChapter === idx ? 'is-active' : ''}`}
                        onClick={() => jumpToChapter(idx)}
                      >
                        {ch.tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SCROLL-SCRUBBED WORD-HIGHLIGHT STATEMENT */}
        <section
          ref={statementRef}
          className="kl-statement-section"
          aria-label="Manifesto Kronner"
        >
          <div className="kl-wrap">
            <p className="kl-statement-text">
              {STATEMENT_WORDS.map((word, idx) => {
                const threshold = idx / STATEMENT_WORDS.length;
                const lit = statementProgress >= threshold * 0.92;
                return (
                  <span
                    key={idx}
                    className={`kl-word ${lit ? 'is-lit' : ''} ${word.tone ? `tone-${word.tone}` : ''}`}
                  >
                    {word.text}{' '}
                  </span>
                );
              })}
            </p>
          </div>
        </section>

        {/* LIGHT MINERAL CONTRAST BAND — BOTH SIDES OF KRONER */}
        <section id="dois-lados" className="kl-light-section" aria-labelledby="two-sides-heading">
          <div className="kl-wrap">
            <div className="kl-light-header">
              <h2 id="two-sides-heading">
                Feita para quem comanda a cadeira e para quem agenda em segundos.
              </h2>
              <p>
                Nenhuma gambiarra de planilha para você, nenhum cadastro burocrático repetido para
                o seu cliente.
              </p>
            </div>

            <div className="kl-dual-grid">
              <article className="kl-dual-panel is-barber">
                <div className="kl-dual-icon">
                  <Scissors size={22} />
                </div>
                <h3>Painel de comando da barbearia</h3>
                <p>
                  Configure expediente dia a dia, pausa de almoço, intervalo de segurança, equipe
                  com permissões de sócio ou funcionário, clientes mensalistas e estoque de
                  produtos no mesmo lugar.
                </p>
                <ul className="kl-check-list">
                  <li>
                    <Check size={15} /> Múltiplas cadeiras com agenda individual ou geral
                  </li>
                  <li>
                    <Check size={15} /> Comissões automáticas por profissional ou por serviço
                  </li>
                  <li>
                    <Check size={15} /> Atalho pronto para enviar seu link no WhatsApp
                  </li>
                  <li>
                    <Check size={15} /> Relatórios financeiros prontos para imprimir ou salvar em PDF
                  </li>
                </ul>
                <Link className="kl-btn kl-btn-dark" href="/entrar?mode=signup">
                  Abrir minha barbearia <ArrowRight size={15} className="kl-arrow" />
                </Link>
              </article>

              <article className="kl-dual-panel is-client">
                <div className="kl-dual-icon is-brass">
                  <User size={22} />
                </div>
                <h3>Experiência limpa para o seu cliente</h3>
                <p>
                  Ao receber seu link, o cliente entra uma única vez, escolhe os serviços desejados
                  e vê somente os dias verdes em que existe espaço real para aquele atendimento.
                </p>
                <ul className="kl-check-list">
                  <li>
                    <Check size={15} /> Escolha de profissional ou primeiro horário livre
                  </li>
                  <li>
                    <Check size={15} /> Filtros por manhã, tarde e noite sem confusão
                  </li>
                  <li>
                    <Check size={15} /> Área Meus horários com histórico e cancelamento no prazo
                  </li>
                  <li>
                    <Check size={15} /> Pagamento direto na barbearia, sem fricção online
                  </li>
                </ul>
                <Link className="kl-btn kl-btn-outline-dark" href="/meus-horarios">
                  Ver meus agendamentos <ArrowRight size={15} className="kl-arrow" />
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* TRANSPARENT PRICING & CLOSING CTA */}
        <section id="planos" className="kl-pricing-section" aria-labelledby="pricing-heading">
          <div className="kl-wrap">
            <div className="kl-pricing-layout">
              <div className="kl-pricing-copy">
                <h2 id="pricing-heading">Preço direto, proporcional ao tamanho da sua equipe.</h2>
                <p>
                  Comece com 15 dias gratuitos sem cadastrar cartão. Quando sua barbearia crescer,
                  adicione novas cadeiras diretamente pelas configurações com ajuste proporcional na
                  fatura.
                </p>
                <div className="kl-pricing-guarantee">
                  <Clock size={17} />
                  <span>Configuração guiada em 6 passos · ativa no mesmo dia.</span>
                </div>
              </div>

              <div
                ref={pricingCardRef}
                className="kl-pricing-card kl-glass-card"
                onPointerMove={handlePricingPointerMove}
                onPointerLeave={handlePricingPointerLeave}
              >
                <div className="kl-glass-spotlight" aria-hidden="true" />
                <div className="kl-price-top">
                  <div>
                    <h3>Plano Principal</h3>
                    <p>Inclui 1 cadeira completa e todas as ferramentas do sistema.</p>
                  </div>
                  <div className="kl-price-figure">
                    <strong>R$ 99,90</strong>
                    <small>/mês</small>
                  </div>
                </div>

                <div className="kl-price-extra">
                  <span>Cadeira adicional (sócio ou funcionário)</span>
                  <b>+ R$ 35,90/mês</b>
                </div>

                <ul className="kl-price-features">
                  <li>
                    <Check size={15} /> Agenda por cadeira, bloqueios e link público fixo
                  </li>
                  <li>
                    <Check size={15} /> Feriados nacionais, estaduais e municipais pelo CEP
                  </li>
                  <li>
                    <Check size={15} /> Financeiro, PDV, comissões, estoque e mensalistas
                  </li>
                  <li>
                    <Check size={15} /> 15 dias de teste grátis sem cartão de crédito
                  </li>
                </ul>

                <div className="kl-price-actions">
                  <Link className="kl-btn kl-btn-primary kl-btn-lg" href="/entrar?mode=signup">
                    Começar 15 dias grátis <ArrowRight size={16} className="kl-arrow" />
                  </Link>
                  <Link className="kl-btn kl-btn-secondary kl-btn-lg" href="/entrar">
                    Entrar na minha conta
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="kl-footer">
        <div className="kl-wrap kl-footer-inner">
          <div className="kl-footer-brand">
            <BrandLogo variant="light" height={28} />
            <span>Tempo para o seu talento · kronner.tec@gmail.com</span>
          </div>
          <nav className="kl-footer-links" aria-label="Links do rodapé">
            <Link href="/entrar">Acessar painel</Link>
            <Link href="/meus-horarios">Meus horários</Link>
            <Link href="/privacidade">Privacidade (LGPD)</Link>
            <Link href="/termos">Termos</Link>
            <Link href="/reembolso">Reembolso</Link>
            <Link href="/cookies">Cookies</Link>
            <button
              type="button"
              className="kl-footer-btn"
              onClick={openCookieSettings}
            >
              Preferências de cookies
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
