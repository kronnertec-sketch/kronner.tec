'use client';

import { useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FileBarChart,
  HelpCircle,
  LayoutDashboard,
  MessageCircle,
  Percent,
  Plus,
  Repeat,
  Scissors,
  Settings,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';

export type DemoFeatureId = 'agenda' | 'booking' | 'finance' | 'holidays';

const HERO_BARS = [
  { day: 'Seg', count: 11, height: 58, active: false },
  { day: 'Ter', count: 14, height: 74, active: false },
  { day: 'Qua', count: 12, height: 63, active: false },
  { day: 'Qui', count: 16, height: 84, active: false },
  { day: 'Sex', count: 19, height: 100, active: true },
  { day: 'Sáb', count: 17, height: 89, active: false },
];

/**
 * Static, live-HTML replica of Kronner's real /painel dashboard
 * for the Desktop Hero stage ("como se ela já tivesse funcionando").
 */
export function HeroDashboardPreview() {
  return (
    <div className="kl2-hero-frame" aria-label="Prévia do painel Kronner em funcionamento">
      {/* Real Floating Top Pill Navigation Bar */}
      <div className="kl2-app-topnav">
        <div className="kl2-app-brand">
          <BrandLogo variant="dark" height={24} />
        </div>
        <div className="kl2-app-pills" aria-hidden="true">
          <span className="is-active">Visão geral</span>
          <span>Agenda</span>
          <span>Clientes</span>
          <span>Financeiro</span>
          <span>Relatórios</span>
        </div>
        <div className="kl2-app-top-right" aria-hidden="true">
          <span className="kl2-app-circle">
            <Bell size={13} />
            <i className="kl2-app-dot" />
          </span>
          <span className="kl2-app-circle">
            <HelpCircle size={13} />
          </span>
          <span className="kl2-app-user">
            <span className="kl2-app-avatar">C</span>
            <span>
              <b>Navalha Sul</b>
              <small>Proprietário</small>
            </span>
          </span>
        </div>
      </div>

      {/* Real Left Icon Rail + Executive Bento Grid */}
      <div className="kl2-app-body">
        <div className="kl2-app-rail" aria-hidden="true">
          <div className="kl2-app-rail-group">
            <span className="is-active"><LayoutDashboard size={14} /></span>
            <span><CalendarDays size={14} /></span>
            <span><Users size={14} /></span>
            <span><Repeat size={14} /></span>
          </div>
          <div className="kl2-app-rail-group">
            <span><UserCog size={14} /></span>
            <span><Wallet size={14} /></span>
            <span><FileBarChart size={14} /></span>
          </div>
          <div className="kl2-app-rail-group">
            <span><Settings size={14} /></span>
          </div>
        </div>

        <div className="kl2-app-main">
          <div className="kl2-app-greeting">
            <div>
              <strong>Bom dia, Caio</strong>
              <small>Sexta-feira · 19 atendimentos previstos hoje</small>
            </div>
            <span className="kl2-app-cta-pill">
              <Plus size={13} /> Novo agendamento
            </span>
          </div>

          <div className="kl2-app-bento">
            {/* Emerald Focal Card */}
            <div className="kl2-app-focal">
              <div className="kl2-app-focal-head">
                <span>Recebidos hoje</span>
                <span className="kl2-app-focal-badge">+18%</span>
              </div>
              <div className="kl2-app-focal-value">R$ 1.240,00</div>
              <div className="kl2-app-focal-foot">
                <span>Pix R$ 780</span>
                <span>Cartão R$ 340</span>
                <span>Dinheiro R$ 120</span>
              </div>
            </div>

            {/* Real 6-Day Hatched Emerald Bar Chart */}
            <div className="kl2-app-chart-card">
              <div className="kl2-app-card-head">
                <div>
                  <b>Movimento da semana</b>
                  <small>Atendimentos por dia</small>
                </div>
                <span className="kl2-app-pill-tag">89 na semana</span>
              </div>
              <div className="kl2-app-bars">
                {HERO_BARS.map((bar, idx) => (
                  <div key={bar.day} className="kl2-app-bar-col">
                    <div className="kl2-app-bar-track">
                      <div
                        className={`kl2-app-bar-fill kl2-bar-grow ${bar.active ? 'is-peak' : ''}`}
                        style={{ height: `${bar.height}%`, animationDelay: `${360 + idx * 55}ms` }}
                      />
                    </div>
                    <span>{bar.day}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Agenda Snapshot */}
            <div className="kl2-app-queue-card">
              <div className="kl2-app-card-head">
                <div>
                  <b>Próximos na cadeira</b>
                  <small>Com intervalo de 10 min</small>
                </div>
                <span className="kl2-app-pill-tag">3 cadeiras</span>
              </div>
              <div className="kl2-app-queue-list">
                <div className="kl2-app-queue-row kl2-queue-enter" style={{ animationDelay: '460ms' }}>
                  <span className="kl2-app-time">14:00</span>
                  <div>
                    <b>Lucas Almeida</b>
                    <small>Corte degradê + Barba · Caio</small>
                  </div>
                  <span className="kl2-app-status is-done">Concluído</span>
                </div>
                <div className="kl2-app-queue-row is-now kl2-queue-enter" style={{ animationDelay: '540ms' }}>
                  <span className="kl2-app-time">14:50</span>
                  <div>
                    <b>Matheus Costa</b>
                    <small>Corte social · Rafael</small>
                  </div>
                  <span className="kl2-app-status is-active">
                    <i className="kl2-live-dot" aria-hidden="true" /> Na cadeira
                  </span>
                </div>
                <div className="kl2-app-queue-row kl2-queue-enter" style={{ animationDelay: '620ms' }}>
                  <span className="kl2-app-time">15:30</span>
                  <div>
                    <b>Pedro Henrique</b>
                    <small>Barba navalhada · Caio</small>
                  </div>
                  <span className="kl2-app-status">Confirmado</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact static dashboard snapshot tailored for Mobile Hero (< 960px).
 */
export function MobileHeroDashboardPreview() {
  return (
    <div className="kl2-mob-hero-frame" aria-label="Prévia do painel Kronner no celular">
      <div className="kl2-mob-app-bar">
        <BrandLogo variant="dark" height={20} />
        <span className="kl2-app-avatar">C</span>
      </div>

      <div className="kl2-app-focal is-compact">
        <div className="kl2-app-focal-head">
          <span>Recebidos hoje</span>
          <span className="kl2-app-focal-badge">+18%</span>
        </div>
        <div className="kl2-app-focal-value">R$ 1.240,00</div>
        <div className="kl2-app-focal-foot">
          <span>19 atendimentos</span>
          <span>Pix R$ 780</span>
        </div>
      </div>

      <div className="kl2-mob-mini-chart">
        <div className="kl2-app-bars is-compact">
          {HERO_BARS.map((bar, idx) => (
            <div key={bar.day} className="kl2-app-bar-col">
              <div className="kl2-app-bar-track">
                <div
                  className={`kl2-app-bar-fill kl2-bar-grow ${bar.active ? 'is-peak' : ''}`}
                  style={{ height: `${bar.height}%`, animationDelay: `${320 + idx * 50}ms` }}
                />
              </div>
              <span>{bar.day}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="kl2-app-queue-list is-compact">
        <div className="kl2-app-queue-row is-now kl2-queue-enter" style={{ animationDelay: '420ms' }}>
          <span className="kl2-app-time">14:50</span>
          <div>
            <b>Matheus Costa</b>
            <small>Corte degradê · Rafael</small>
          </div>
          <span className="kl2-app-status is-active">
            <i className="kl2-live-dot" aria-hidden="true" /> Agora
          </span>
        </div>
        <div className="kl2-app-queue-row kl2-queue-enter" style={{ animationDelay: '500ms' }}>
          <span className="kl2-app-time">15:30</span>
          <div>
            <b>Pedro Henrique</b>
            <small>Barba navalhada · Caio</small>
          </div>
          <span className="kl2-app-status">Confirmado</span>
        </div>
      </div>
    </div>
  );
}

const DEMO_APPOINTMENTS = [
  { id: 'a1', time: '09:30', client: 'Bruno Ferreira', service: 'Corte degradê', chair: 'Caio', status: 'done' as const, price: 'R$ 55,00' },
  { id: 'a2', time: '10:20', client: 'Lucas Almeida', service: 'Corte + Barba', chair: 'Rafael', status: 'booked' as const, price: 'R$ 85,00' },
  { id: 'a3', time: '11:10', client: 'Diego Martins', service: 'Barba navalhada', chair: 'Caio', status: 'booked' as const, price: 'R$ 40,00' },
  { id: 'a4', time: '14:00', client: 'Matheus Costa', service: 'Corte social', chair: 'Rafael', status: 'booked' as const, price: 'R$ 50,00' },
];

const DEMO_SERVICES = [
  { id: 'corte', name: 'Corte degradê', duration: '35 min', price: 'R$ 55' },
  { id: 'barba', name: 'Barba navalhada', duration: '25 min', price: 'R$ 40' },
  { id: 'combo', name: 'Corte + Barba', duration: '55 min', price: 'R$ 85' },
];

const DEMO_SLOTS: Record<'manha' | 'tarde', string[]> = {
  manha: ['09:00', '09:45', '10:30', '11:15'],
  tarde: ['14:00', '14:45', '15:30', '16:15'],
};

/**
 * Interactive real-UI demonstration of Kronner's 4 core modules.
 * Visitors can click chairs, toggle services/slots, switch Finance/Commission tabs,
 * and test the CEP holiday decision directly on the landing page.
 */
export function InteractiveFeatureDemo({ feature }: { feature: DemoFeatureId }) {
  // Agenda state
  const [chair, setChair] = useState<'Todas' | 'Caio' | 'Rafael'>('Todas');
  const [doneIds, setDoneIds] = useState<string[]>(['a1']);

  // Public booking link state
  const [selectedSvc, setSelectedSvc] = useState('combo');
  const [period, setPeriod] = useState<'manha' | 'tarde'>('tarde');
  const [slot, setSlot] = useState('14:45');
  const [booked, setBooked] = useState(false);

  // Finance / Commissions state
  const [finTab, setFinTab] = useState<'caixa' | 'comissoes'>('caixa');

  // Holidays state
  const [holidayChoice, setHolidayChoice] = useState<'open' | 'closed' | null>(null);

  if (feature === 'agenda') {
    const visible = DEMO_APPOINTMENTS.filter(a => chair === 'Todas' || a.chair === chair);
    const toggleDone = (id: string) =>
      setDoneIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

    return (
      <div className="kl2-demo-surface">
        <div className="kl2-demo-bar">
          <div className="kl2-demo-bar-title">
            <CalendarDays size={16} />
            <strong>Agenda · Hoje</strong>
          </div>
          <div className="kl2-demo-seg" role="tablist" aria-label="Filtrar cadeira">
            {(['Todas', 'Caio', 'Rafael'] as const).map(c => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={chair === c}
                className={chair === c ? 'is-active' : ''}
                onClick={() => setChair(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="kl2-demo-list">
          {visible.map((item, idx) => {
            const isDone = doneIds.includes(item.id);
            return (
              <div
                key={`${chair}-${item.id}`}
                className={`kl2-demo-row kl2-row-enter ${isDone ? 'is-done' : ''}`}
                style={{ animationDelay: `${idx * 45}ms` }}
              >
                <span className="kl2-app-time">{item.time}</span>
                <div className="kl2-demo-row-main">
                  <b>{item.client}</b>
                  <small>
                    {item.service} · {item.chair} · {item.price}
                  </small>
                </div>
                <button
                  type="button"
                  className={`kl2-demo-check ${isDone ? 'is-done' : ''}`}
                  onClick={() => toggleDone(item.id)}
                >
                  <CheckCircle2 size={14} />
                  <span>{isDone ? 'Concluído' : 'Concluir'}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="kl2-demo-foot">
          <span>
            <Clock size={13} /> Intervalo automático de 10 min ativo
          </span>
          <span className="kl2-demo-wa">
            <MessageCircle size={13} /> Lembrete WhatsApp em 1 toque
          </span>
        </div>
      </div>
    );
  }

  if (feature === 'booking') {
    const activeSvc = DEMO_SERVICES.find(s => s.id === selectedSvc) || DEMO_SERVICES[0];
    return (
      <div className="kl2-demo-surface">
        <div className="kl2-demo-bar">
          <div className="kl2-demo-url">
            <Scissors size={14} />
            <span>kronner.vercel.app/b/navalha-sul</span>
          </div>
          <span className="kl2-app-pill-tag">
            <Copy size={12} /> Link na bio
          </span>
        </div>

        <div className="kl2-demo-booking-body">
          <div className="kl2-demo-svc-grid">
            {DEMO_SERVICES.map(svc => (
              <button
                key={svc.id}
                type="button"
                className={`kl2-demo-svc ${selectedSvc === svc.id ? 'is-active' : ''}`}
                onClick={() => {
                  setSelectedSvc(svc.id);
                  setBooked(false);
                }}
              >
                <b>{svc.name}</b>
                <small>
                  {svc.duration} · {svc.price}
                </small>
              </button>
            ))}
          </div>

          <div className="kl2-demo-period-row">
            <div className="kl2-demo-seg" role="tablist" aria-label="Período">
              <button
                type="button"
                role="tab"
                aria-selected={period === 'manha'}
                className={period === 'manha' ? 'is-active' : ''}
                onClick={() => {
                  setPeriod('manha');
                  setSlot(DEMO_SLOTS.manha[1]);
                  setBooked(false);
                }}
              >
                Manhã
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={period === 'tarde'}
                className={period === 'tarde' ? 'is-active' : ''}
                onClick={() => {
                  setPeriod('tarde');
                  setSlot(DEMO_SLOTS.tarde[1]);
                  setBooked(false);
                }}
              >
                Tarde
              </button>
            </div>
            <span className="kl2-demo-hint">Só horários onde {activeSvc.duration} cabem</span>
          </div>

          <div className="kl2-demo-slots">
            {DEMO_SLOTS[period].map(s => (
              <button
                key={s}
                type="button"
                className={`kl2-demo-slot ${slot === s ? 'is-active' : ''}`}
                onClick={() => {
                  setSlot(s);
                  setBooked(false);
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`kl2-demo-confirm ${booked ? 'is-booked' : ''}`}
            onClick={() => setBooked(true)}
          >
            {booked ? (
              <>
                <Check size={15} /> Horário reservado às {slot} · {activeSvc.name}
              </>
            ) : (
              <>Reservar {slot} · {activeSvc.price}</>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (feature === 'finance') {
    return (
      <div className="kl2-demo-surface">
        <div className="kl2-demo-bar">
          <div className="kl2-demo-bar-title">
            <Wallet size={16} />
            <strong>Financeiro de serviços</strong>
          </div>
          <div className="kl2-demo-seg" role="tablist" aria-label="Visão financeira">
            <button
              type="button"
              role="tab"
              aria-selected={finTab === 'caixa'}
              className={finTab === 'caixa' ? 'is-active' : ''}
              onClick={() => setFinTab('caixa')}
            >
              Caixa do dia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={finTab === 'comissoes'}
              className={finTab === 'comissoes' ? 'is-active' : ''}
              onClick={() => setFinTab('comissoes')}
            >
              Comissões
            </button>
          </div>
        </div>

        {finTab === 'caixa' ? (
          <div className="kl2-demo-fin-body">
            <div className="kl2-demo-fin-kpis">
              <div className="kl2-demo-kpi is-emerald">
                <small>Líquido hoje</small>
                <strong>R$ 1.226,40</strong>
              </div>
              <div className="kl2-demo-kpi">
                <small>Taxas de cartão</small>
                <strong>R$ 13,60</strong>
              </div>
            </div>
            <div className="kl2-demo-list">
              <div className="kl2-demo-row">
                <span className="kl2-app-pill-tag">Pix</span>
                <div className="kl2-demo-row-main">
                  <b>11 recebimentos</b>
                  <small>Sem desconto de taxa</small>
                </div>
                <strong className="kl2-tabular">R$ 780,00</strong>
              </div>
              <div className="kl2-demo-row">
                <span className="kl2-app-pill-tag">Crédito</span>
                <div className="kl2-demo-row-main">
                  <b>5 recebimentos</b>
                  <small>Taxa de 4,0% descontada automaticamente</small>
                </div>
                <strong className="kl2-tabular">R$ 326,40</strong>
              </div>
              <div className="kl2-demo-row">
                <span className="kl2-app-pill-tag">Dinheiro</span>
                <div className="kl2-demo-row-main">
                  <b>3 recebimentos</b>
                  <small>Em caixa</small>
                </div>
                <strong className="kl2-tabular">R$ 120,00</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="kl2-demo-fin-body">
            <div className="kl2-demo-list">
              <div className="kl2-demo-row">
                <span className="kl2-app-avatar">R</span>
                <div className="kl2-demo-row-main">
                  <b>Rafael Silva · 45%</b>
                  <small>Produção R$ 1.840,00 · Pago R$ 500,00</small>
                </div>
                <div className="kl2-demo-comm-val">
                  <small>Saldo a pagar</small>
                  <strong className="kl2-tabular">R$ 328,00</strong>
                </div>
              </div>
              <div className="kl2-demo-row">
                <span className="kl2-app-avatar is-brass">M</span>
                <div className="kl2-demo-row-main">
                  <b>Marcos Lima · 40%</b>
                  <small>Produção R$ 1.250,00 · Pago R$ 500,00</small>
                </div>
                <div className="kl2-demo-comm-val">
                  <small>Saldo a pagar</small>
                  <strong className="kl2-tabular is-clear">R$ 0,00</strong>
                </div>
              </div>
            </div>
            <div className="kl2-demo-foot">
              <span>
                <Percent size={13} /> Percentual individual ativável por funcionário
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // holidays
  return (
    <div className="kl2-demo-surface">
      <div className="kl2-demo-bar">
        <div className="kl2-demo-bar-title">
          <Bell size={16} />
          <strong>Avisos · Feriados pelo CEP</strong>
        </div>
        <span className="kl2-app-pill-tag">Automático</span>
      </div>

      <div className="kl2-demo-holiday-card">
        <div className="kl2-demo-holiday-top">
          <div>
            <b>Tiradentes · 21/04</b>
            <small>Feriado nacional detectado pelo CEP da sua barbearia</small>
          </div>
          <span
            className={`kl2-app-status ${
              holidayChoice === 'open'
                ? 'is-done'
                : holidayChoice === 'closed'
                  ? 'is-warn'
                  : 'is-active'
            }`}
          >
            {holidayChoice === 'open'
              ? 'Agenda aberta'
              : holidayChoice === 'closed'
                ? 'Agenda fechada'
                : 'Aguardando decisão'}
          </span>
        </div>

        <p className="kl2-demo-holiday-msg">
          {holidayChoice === 'open'
            ? 'Horários liberados no seu link público para clientes agendarem normalmente neste feriado.'
            : holidayChoice === 'closed'
              ? 'Dia bloqueado automaticamente no link público. Nenhum cliente conseguirá reservar nesta data.'
              : 'Defina em um toque se a barbearia vai abrir ou fechar — você pode alterar depois na aba Avisos.'}
        </p>

        <div className="kl2-demo-holiday-actions">
          <button
            type="button"
            className={`kl2-demo-choice ${holidayChoice === 'open' ? 'is-selected' : ''}`}
            onClick={() => setHolidayChoice('open')}
          >
            <Check size={14} /> Vou trabalhar
          </button>
          <button
            type="button"
            className={`kl2-demo-choice ${holidayChoice === 'closed' ? 'is-selected-dark' : ''}`}
            onClick={() => setHolidayChoice('closed')}
          >
            Fechar agenda
          </button>
        </div>
      </div>
    </div>
  );
}
