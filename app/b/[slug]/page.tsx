'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Moon,
  Plus,
  Sun,
  Sunset,
  User,
  X,
} from 'lucide-react';
import { SignIn, SignUp, useAuth, useClerk, useSession, useUser } from '@clerk/react';
import { useApi } from '@/lib/supabase';
import { money, phone, today, days } from '@/lib/domain';
import { notifyAppointmentEvent } from '@/lib/push-client';
import type { Row } from '@/lib/types';
import { BrandLogo } from '@/components/BrandLogo';

function formatBrPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits || String(raw);
}

export default function Booking({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [chair, setChair] = useState<string | null>(null);
  const [authTab, setAuthTab] = useState<'signup' | 'signin'>('signup');
  useEffect(() => {
    const raw = new URLSearchParams(location.search).get('p') || 'auto';
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    setChair(raw === 'auto' || validUuid ? raw : 'auto');
  }, []);
  const call = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const { session } = useSession();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
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
    [profile, F] = useState({ name: '', phone: '' }),
    [profileSaved, setProfileSaved] = useState(false);

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

  // Auto-fill client name & phone from saved DB profile on 2nd+ visits (always editable)
  useEffect(() => {
    if (!user || !session) return;
    let alive = true;
    call('client_profile', { p_slug: slug })
      .then((res) => {
        if (!alive) return;
        if (res?.found) {
          const savedName = typeof res.name === 'string' ? res.name : '';
          const savedPhone = formatBrPhoneDisplay(res.phone);
          setProfileSaved(Boolean(savedName || savedPhone));
          F((prev) => ({
            name: prev.name || savedName,
            phone: prev.phone || savedPhone,
          }));
        } else {
          setProfileSaved(false);
          const fallbackName = clerkUser?.fullName?.trim() || clerkUser?.firstName?.trim() || '';
          if (fallbackName) {
            F((prev) => ({ ...prev, name: prev.name || fallbackName }));
          }
        }
      })
      .catch(() => {
        if (!alive) return;
        const fallbackName = clerkUser?.fullName?.trim() || clerkUser?.firstName?.trim() || '';
        if (fallbackName) {
          F((prev) => ({ ...prev, name: prev.name || fallbackName }));
        }
      });
    return () => {
      alive = false;
    };
  }, [user, session?.id, slug, call, clerkUser?.fullName, clerkUser?.firstName]);

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
    const base = new Date(today(shop.cfg?.timezone) + 'T12:00:00Z');
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
        '/entrar?mode=signup&next=' +
          encodeURIComponent('/b/' + slug + (chair && chair !== 'auto' ? '?p=' + chair : ''))
      );
      return;
    }
    if (!slot) return;
    B(true);
    E('');
    try {
      const trimmedName = profile.name.trim();
      if (trimmedName.length < 2) {
        throw new Error('Informe seu nome completo.');
      }
      const created = await call('book', {
        slug,
        professional: slot.professional || shop?.professional,
        services: selected,
        period,
        day,
        start: slot.start,
        name: trimmedName,
        phone: phone(profile.phone),
        request_id: crypto.randomUUID(),
      });
      if (created?.id && session) {
        const token = await session
          .getToken({ template: 'kroner_claims' })
          .catch(() => session.getToken());
        void notifyAppointmentEvent(token, String(created.id), 'booking_created');
      }
      OK(true);
      sessionStorage.removeItem('booking:' + slug);
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }

  const returnPath =
    '/b/' + slug + (chair && chair !== 'auto' ? '?p=' + encodeURIComponent(chair) : '');
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
  const userEmail = clerkUser?.primaryEmailAddress?.emailAddress || '';

  return (
    <main className="booking">
      <header className="booking-top">
        <Link className="brand" href="/">
          <BrandLogo variant="dark" height={31} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user && (
            <Link className="btn small" href="/meus-horarios">
              <CalendarDays size={14} /> Meus horários
            </Link>
          )}
        </div>
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

          {user && !success && (
            <div className="booking-account-strip">
              <span>
                <CheckCircle2 size={14} />
                Conectado{userEmail ? ` como ${userEmail}` : ''}
              </span>
              <button
                type="button"
                className="booking-switch-btn"
                onClick={async () => {
                  try {
                    sessionStorage.removeItem('booking:' + slug);
                    sessionStorage.removeItem('kroner:convite');
                  } catch {}
                  await signOut();
                  V([]);
                  P('');
                  D('');
                  T(null);
                  SS([]);
                  DS([]);
                  F({ name: '', phone: '' });
                  setProfileSaved(false);
                  E('');
                }}
              >
                <LogOut size={13} /> Trocar conta
              </button>
            </div>
          )}

          {user && !success && shop.professionals?.length > 1 && (
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
            <section className="card booking-auth-gate" aria-label="Acesse sua conta para agendar">
              <div className="booking-auth-header">
                <h2>
                  {user === null
                    ? 'Verificando seu acesso…'
                    : authTab === 'signup'
                      ? `Crie sua conta para agendar em ${shop.name}`
                      : `Entre para agendar em ${shop.name}`}
                </h2>
                <p>
                  Entre rapidinho com <strong>Google ou e-mail</strong>. Na primeira vez você informa
                  seu nome e WhatsApp com DDD — nas próximas visitas o sistema já preenche tudo
                  automaticamente.
                </p>

                {user !== null && (
                  <div className="booking-auth-tabs" role="tablist" aria-label="Tipo de acesso">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authTab === 'signup'}
                      className={authTab === 'signup' ? 'is-active' : ''}
                      onClick={() => {
                        if (window.location.hash) {
                          history.replaceState(null, '', location.pathname + location.search);
                        }
                        setAuthTab('signup');
                      }}
                    >
                      Criar conta grátis
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authTab === 'signin'}
                      className={authTab === 'signin' ? 'is-active' : ''}
                      onClick={() => {
                        if (window.location.hash) {
                          history.replaceState(null, '', location.pathname + location.search);
                        }
                        setAuthTab('signin');
                      }}
                    >
                      Já tenho conta
                    </button>
                  </div>
                )}
              </div>

              {user !== null && (
                <div className="booking-clerk-box">
                  {authTab === 'signup' ? (
                    <SignUp
                      routing="hash"
                      signInUrl={'/entrar?mode=signin&next=' + encodeURIComponent(returnPath)}
                      forceRedirectUrl={returnPath}
                    />
                  ) : (
                    <SignIn
                      routing="hash"
                      signUpUrl={'/entrar?mode=signup&next=' + encodeURIComponent(returnPath)}
                      forceRedirectUrl={returnPath}
                    />
                  )}
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
                A confirmação fica aqui e em Meus horários. Você pode remarcar ou cancelar por lá
                dentro do prazo da barbearia.
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
                    {profileSaved ? (
                      <p className="booking-autofill-note">
                        <CheckCircle2 size={13} />
                        <span>
                          Seus dados foram preenchidos automaticamente. Se trocou de número, apague
                          e digite o novo — atualizamos no cadastro da barbearia.
                        </span>
                      </p>
                    ) : (
                      <p className="booking-autofill-note is-first">
                        Informe seu nome e telefone uma única vez — nas próximas visitas
                        preencheremos automaticamente.
                      </p>
                    )}
                    <label>
                      Seu nome
                      <input
                        placeholder="Ex.: Lucas Silva"
                        autoComplete="name"
                        value={profile.name}
                        onChange={(e) => F({ ...profile, name: e.target.value })}
                      />
                    </label>
                    <label>
                      Telefone com DDD
                      <div className="booking-input-clearable">
                        <input
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="(34) 99999-9999"
                          value={profile.phone}
                          onChange={(e) => F({ ...profile, phone: e.target.value })}
                        />
                        {profile.phone && (
                          <button
                            type="button"
                            className="booking-clear-field"
                            aria-label="Apagar telefone para digitar outro número"
                            title="Apagar e digitar novo número"
                            onClick={() => F({ ...profile, phone: '' })}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
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
                  {busy ? 'Aguarde…' : 'Confirmar horário'} <ArrowRight size={15} />
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
