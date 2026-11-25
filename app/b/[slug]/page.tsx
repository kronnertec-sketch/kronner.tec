'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  MapPin,
  Moon,
  Plus,
  Scissors,
  Sun,
  Sunset,
  User,
} from 'lucide-react';
import { useApi } from '@/lib/supabase';
import { useAuth } from '@clerk/react';
import { money, phone, today, days } from '@/lib/domain';
import type { Row } from '@/lib/types';
import { BrandLogo } from '@/components/BrandLogo';

export default function Booking({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [chair, setChair] = useState<string | null>(null);
  useEffect(() => {
    setChair(new URLSearchParams(location.search).get('p') || 'auto');
  }, []);
  const call = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const user = isLoaded ? !!isSignedIn : null;
  const [shop, S] = useState<Row | null>(null),
    [selected, V] = useState<string[]>([]),
    [period, P] = useState(''),
    [day, D] = useState(''),
    [dates, DS] = useState<Row[]>([]),
    [slots, SS] = useState<Row[]>([]),
    [slot, T] = useState<Row | null>(null),
    [error, E] = useState(''),
    [busy, B] = useState(false),
    [success, OK] = useState(false),
    [profile, F] = useState({ name: '', phone: '' });

  useEffect(() => {
    if (!chair) return;
    let current = true;
    S(null);
    E('');
    D('');
    T(null);
    SS([]);
    call('public', { slug, professional: chair })
      .then((value) => {
        if (current) S(value);
      })
      .catch((e) => {
        if (current) E(e.message);
      });
    return () => {
      current = false;
    };
  }, [slug, chair, call]);

  useEffect(() => {
    const saved = sessionStorage.getItem('booking:' + slug);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        V(d.selected || []);
        P(d.period || '');
      } catch {}
    }
  }, [slug]);

  useEffect(() => {
    sessionStorage.setItem('booking:' + slug, JSON.stringify({ selected, period }));
  }, [slug, selected, period]);

  useEffect(() => {
    if (!user || !shop || !selected.length || !period) {
      DS([]);
      return;
    }
    let alive = true;
    B(true);
    E('');
    D('');
    T(null);
    SS([]);
    const base = new Date(today() + 'T12:00:00Z');
    const all = Array.from({ length: Math.min(shop.cfg.maxDays || 21, 90) + 1 }, (_, i) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    (async () => {
      const result: Row[] = [];
      for (let i = 0; i < all.length; i += 7) {
        const batch = await Promise.all(
          all.slice(i, i + 7).map(async (day) => ({
            day,
            slots: await call('slots', {
              slug,
              professional: chair,
              services: selected,
              period,
              day,
            }),
          }))
        );
        result.push(...batch);
      }
      if (alive) DS(result);
    })()
      .catch((e) => alive && E(e.message))
      .finally(() => alive && B(false));
    return () => {
      alive = false;
    };
  }, [shop, selected, period, slug, user, chair]);

  async function confirm() {
    if (!user) {
      location.assign(
        '/entrar?next=' +
          encodeURIComponent('/b/' + slug + (chair && chair !== 'auto' ? '?p=' + chair : ''))
      );
      return;
    }
    if (!slot) return;
    B(true);
    E('');
    try {
      await call('book', {
        slug,
        professional: slot.professional || shop?.professional,
        services: selected,
        period,
        day,
        start: slot.start,
        name: profile.name,
        phone: phone(profile.phone),
        request_id: crypto.randomUUID(),
      });
      OK(true);
      sessionStorage.removeItem('booking:' + slug);
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }

  const chosen = shop?.services.filter((s: Row) => selected.includes(s.id)) || [];
  const duration = chosen.reduce((n: number, s: Row) => n + s.duration, 0);
  const range = (p: string) => {
    if (!shop) return '';
    const ranges = shop.cfg.week
      .filter((w: Row) => w.enabled)
      .map((w: Row) => {
        let a = w.open,
          b = w.close;
        if (p === 'morning') b = (w.lunchStart || '11:00') < b ? w.lunchStart || '11:00' : b;
        if (p === 'afternoon') {
          a = (w.lunchEnd || '11:00') > a ? w.lunchEnd || '11:00' : a;
          b = b < '18:00' ? b : '18:00';
        }
        if (p === 'night') a = a > '18:00' ? a : '18:00';
        return a < b ? a + '–' + b : '';
      })
      .filter(Boolean);
    return [...new Set(ranges)].join(' / ');
  };

  const periodOptions = [
    { key: 'morning', label: 'Manhã', Icon: Sun },
    { key: 'afternoon', label: 'Tarde', Icon: Sunset },
    { key: 'night', label: 'Noite', Icon: Moon },
  ].filter((item) => range(item.key));

  const currentStep = !selected.length ? 1 : !period ? 2 : 3;

  return (
    <main className="booking">
      <header className="booking-top">
        <Link className="brand" href="/">
          <BrandLogo variant="dark" height={31} />
        </Link>
        <Link className="btn small" href="/meus-horarios">
          <CalendarDays size={14} /> Meus horários
        </Link>
      </header>

      {!shop ? (
        <div className="card booking-loading-card">
          <p>{error || 'Carregando barbearia…'}</p>
          {error && chair !== 'auto' && (
            <a className="btn" href={'/b/' + slug}>
              Ver agenda geral
            </a>
          )}
        </div>
      ) : (
        <>
          <section className="booking-hero">
            <div className="booking-hero-main">
              <h1>{shop.name}</h1>
              <p className="booking-location">
                <MapPin size={15} />
                <span>
                  {[shop.cfg.address, shop.cfg.city, shop.cfg.state].filter(Boolean).join(' · ')}
                </span>
              </p>
            </div>
            {user && !success && (
              <ol className="booking-steps-bar" aria-label="Etapas do agendamento">
                <li className={currentStep >= 1 ? (selected.length ? 'is-done' : 'is-active') : ''}>
                  <span>1</span> Serviços
                </li>
                <li className={currentStep >= 2 ? (period ? 'is-done' : 'is-active') : ''}>
                  <span>2</span> Período
                </li>
                <li className={currentStep >= 3 ? (slot ? 'is-done' : 'is-active') : ''}>
                  <span>3</span> Dia e horário
                </li>
              </ol>
            )}
          </section>

          {shop.professionals?.length > 1 && (
            <div className="booking-chair-bar">
              <label className="booking-chair-select">
                <span>
                  <User size={15} /> Profissional
                </span>
                <select
                  value={chair || 'auto'}
                  onChange={(event) => {
                    setChair(event.target.value);
                    V([]);
                    P('');
                  }}
                >
                  <option value="auto">Primeiro horário disponível</option>
                  {shop.professionals.map((person: Row) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {!user ? (
            <section className="card booking-access">
              <div className="booking-access-badge">
                <Scissors size={18} />
              </div>
              <h2>{user === null ? 'Verificando seu acesso…' : 'Acesse sua conta para agendar'}</h2>
              <p>
                Depois de entrar, você escolhe os serviços, o período e o horário em {shop.name}.
                Sua conta vale para todas as barbearias da Kronner.
              </p>
              {user !== null && (
                <div className="actions">
                  <Link
                    className="btn primary"
                    href={
                      '/entrar?mode=signup&next=' +
                      encodeURIComponent(
                        '/b/' + slug + (chair && chair !== 'auto' ? '?p=' + chair : '')
                      )
                    }
                  >
                    Criar minha conta <ArrowRight size={15} />
                  </Link>
                  <Link
                    className="btn"
                    href={
                      '/entrar?next=' +
                      encodeURIComponent(
                        '/b/' + slug + (chair && chair !== 'auto' ? '?p=' + chair : '')
                      )
                    }
                  >
                    Já tenho conta
                  </Link>
                </div>
              )}
            </section>
          ) : success ? (
            <section className="card success">
              <div className="success-icon">
                <Check size={30} strokeWidth={2.4} />
              </div>
              <h2>Horário confirmado!</h2>
              <p>
                {shop.name} · {day.split('-').reverse().join('/')} às {slot?.label}
              </p>
              <p className="success-summary-line">
                {chosen.map((s: Row) => s.name).join(' + ')} ·{' '}
                <strong>{money(chosen.reduce((n: number, s: Row) => n + s.price, 0))}</strong>
              </p>
              <p>
                A confirmação fica aqui e em Meus horários. Não enviamos lembretes por WhatsApp.
              </p>
              <Link className="btn primary" href="/meus-horarios">
                Ver meus agendamentos <ArrowRight size={15} />
              </Link>
            </section>
          ) : (
            <div className="booking-grid">
              <section>
                <div className="card">
                  <div className="section-title">
                    <span className="step">1</span>
                    <h2>O que vamos fazer?</h2>
                  </div>
                  <p>Escolha um ou mais serviços.</p>
                  <div className="service-list">
                    {shop.services.map((s: Row) => {
                      const isPicked = selected.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={'service ' + (isPicked ? 'selected' : '')}
                          onClick={() => {
                            V(
                              isPicked
                                ? selected.filter((x) => x !== s.id)
                                : [...selected, s.id]
                            );
                            D('');
                            T(null);
                          }}
                        >
                          <span className="check">
                            {isPicked ? <Check size={13} strokeWidth={2.5} /> : <Plus size={13} />}
                          </span>
                          <span>
                            <strong>{s.name}</strong>
                            <small>
                              <Clock size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                              {s.duration} minutos
                            </small>
                          </span>
                          <b>{money(s.price)}</b>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!!selected.length && (
                  <div className="card">
                    <div className="section-title">
                      <span className="step">2</span>
                      <h2>Qual período funciona melhor?</h2>
                    </div>
                    <div className="periods">
                      {periodOptions.map(({ key, label, Icon }) => (
                        <button
                          key={key}
                          type="button"
                          className={'period ' + (period === key ? 'selected' : '')}
                          onClick={() => P(key)}
                        >
                          <span className="period-icon">
                            <Icon size={20} strokeWidth={1.85} />
                          </span>
                          <strong>{label}</strong>
                          <small>{range(key)}</small>
                        </button>
                      ))}
                    </div>
                    <small>
                      As faixas podem variar por dia. O atendimento precisa caber inteiro no
                      período.
                    </small>
                  </div>
                )}

                {period && !!selected.length && (
                  <div className="card">
                    <div className="section-title">
                      <span className="step">3</span>
                      <h2>Escolha um dia</h2>
                    </div>
                    <p>
                      {busy
                        ? 'Consultando horários…'
                        : 'Dias em verde têm espaço para os serviços escolhidos.'}
                    </p>
                    <div className="calendar">
                      {dates.map((d) => (
                        <button
                          key={d.day}
                          type="button"
                          disabled={!d.slots.length}
                          className={
                            (d.slots.length ? 'available ' : '') + (day === d.day ? 'selected' : '')
                          }
                          onClick={() => {
                            D(d.day);
                            SS(d.slots);
                            T(null);
                          }}
                        >
                          <small>
                            {days[new Date(d.day + 'T12:00:00Z').getUTCDay()].slice(0, 3)}
                          </small>
                          <strong>{d.day.slice(8)}</strong>
                          <small>{d.day.slice(5, 7)}</small>
                        </button>
                      ))}
                    </div>
                    {!busy && dates.length > 0 && !dates.some((d) => d.slots.length > 0) && (
                      <div className="notice">
                        Não encontramos vagas nesse período. Escolha outro período acima.
                      </div>
                    )}
                    {day && (
                      <div className="booking-slots-block">
                        <h3>Horários em {day.split('-').reverse().join('/')}</h3>
                        <div className="slots">
                          {slots.map((s) => (
                            <button
                              key={s.start}
                              type="button"
                              className={'btn ' + (slot?.start === s.start ? 'primary' : '')}
                              onClick={() => T(s)}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <aside className="card summary">
                <h2>Resumo do horário</h2>
                <p className="summary-shop-name">{shop.name}</p>
                {chosen.length === 0 ? (
                  <p className="summary-empty">Selecione um ou mais serviços ao lado.</p>
                ) : (
                  chosen.map((s: Row) => (
                    <div className="line" key={s.id}>
                      <span>{s.name}</span>
                      <b>{money(s.price)}</b>
                    </div>
                  ))
                )}
                <div className="line total">
                  <span>Total · {duration} min</span>
                  <b>{money(chosen.reduce((n: number, s: Row) => n + s.price, 0))}</b>
                </div>
                {slot && (
                  <div className="summary-slot-details">
                    <p className="summary-slot-pill">
                      <CalendarDays size={14} />
                      <span>
                        {day.split('-').reverse().join('/')} · {slot.label}
                        {shop.professionals?.length > 1
                          ? ` · ${
                              slot.professionalName ||
                              shop.professionals?.find((p: Row) => p.id === shop.professional)?.name
                            }`
                          : ''}
                      </span>
                    </p>
                    <label>
                      Seu nome
                      <input
                        value={profile.name}
                        onChange={(e) => F({ ...profile, name: e.target.value })}
                      />
                    </label>
                    <label>
                      Telefone com DDD
                      <input
                        type="tel"
                        value={profile.phone}
                        onChange={(e) => F({ ...profile, phone: e.target.value })}
                      />
                    </label>
                  </div>
                )}
                {error && (
                  <div role="alert" className="notice danger">
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  className="btn primary"
                  disabled={!slot || busy}
                  onClick={confirm}
                >
                  {busy ? 'Aguarde…' : user ? 'Confirmar horário' : 'Entrar e confirmar'}{' '}
                  <ArrowRight size={15} />
                </button>
                <small>
                  Pagamento realizado diretamente na barbearia. Cancelamento até{' '}
                  {(shop.cfg.cancelMinutes || 0) / 60} h antes. Solicitamos apenas nome e telefone
                  para confirmar seu horário — veja nossa{' '}
                  <Link href="/privacidade">Política de Privacidade (LGPD)</Link>.
                </small>
              </aside>
            </div>
          )}
        </>
      )}
    </main>
  );
}
