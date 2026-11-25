'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clock, LogOut, Moon, RefreshCw, Scissors, Sun, Sunset, User, X } from 'lucide-react';
import { useApi } from '@/lib/supabase';
import { useAuth, useClerk, useSession } from '@clerk/react';
import { days, money, today } from '@/lib/domain';
import { notifyAppointmentEvent } from '@/lib/push-client';
import type { Row } from '@/lib/types';
import { BrandLogo } from '@/components/BrandLogo';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  booked: { label: 'Agendado', cls: '' },
  done: { label: 'Concluído', cls: 'green' },
  cancelled: { label: 'Cancelado', cls: 'warn' },
  absent: { label: 'Não compareceu', cls: 'red' },
};

export default function Appointments() {
  const call = useApi();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { session } = useSession();
  const { signOut } = useClerk();
  const [data, S] = useState<Row[]>([]),
    [error, E] = useState(''),
    [notice, N] = useState(''),
    [busy, B] = useState(true);

  // Inline client reschedule state
  const [rescheduleTarget, setRescheduleTarget] = useState<Row | null>(null);
  const [shopInfo, setShopInfo] = useState<Row | null>(null);
  const [rescheduleChair, setRescheduleChair] = useState('auto');
  const [reschedulePeriod, setReschedulePeriod] = useState('');
  const [rescheduleDays, setRescheduleDays] = useState<Row[]>([]);
  const [rescheduleDay, setRescheduleDay] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<Row[]>([]);
  const [rescheduleSlot, setRescheduleSlot] = useState<Row | null>(null);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [rescheduleErr, setRescheduleErr] = useState('');

  async function getClerkToken() {
    if (!session) return null;
    return session.getToken({ template: 'kroner_claims' }).catch(() => session.getToken());
  }

  async function load() {
    try {
      if (!isSignedIn) {
        location.assign('/entrar?next=/meus-horarios');
        return;
      }
      S(await call('my_appointments'));
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }

  useEffect(() => {
    if (isLoaded) load();
  }, [isLoaded, userId]);

  async function cancel(id: string) {
    if (!confirm('Cancelar este agendamento?')) return;
    E('');
    N('');
    try {
      await call('cancel_own', { id });
      const token = await getClerkToken();
      void notifyAppointmentEvent(token, id, 'booking_cancelled');
      N('Agendamento cancelado com sucesso.');
      await load();
    } catch (e) {
      E((e as Error).message);
    }
  }

  async function openReschedule(apt: Row) {
    setRescheduleTarget(apt);
    setShopInfo(null);
    setRescheduleChair('auto');
    setReschedulePeriod('');
    setRescheduleDays([]);
    setRescheduleDay('');
    setRescheduleSlots([]);
    setRescheduleSlot(null);
    setRescheduleErr('');
    setRescheduleBusy(true);
    try {
      const info = await call('public', { slug: apt.slug, professional: 'auto' });
      setShopInfo(info);
    } catch (e) {
      setRescheduleErr((e as Error).message);
    } finally {
      setRescheduleBusy(false);
    }
  }

  function closeReschedule() {
    setRescheduleTarget(null);
    setShopInfo(null);
    setRescheduleErr('');
  }

  useEffect(() => {
    if (!rescheduleTarget || !shopInfo || !reschedulePeriod) {
      setRescheduleDays([]);
      return;
    }
    let alive = true;
    setRescheduleBusy(true);
    setRescheduleErr('');
    setRescheduleDay('');
    setRescheduleSlots([]);
    setRescheduleSlot(null);

    const serviceIds = (rescheduleTarget.services || []).map((s: Row) => s.id).filter(Boolean);
    const base = new Date(today() + 'T12:00:00Z');
    const all = Array.from({ length: Math.min(shopInfo.cfg?.maxDays || 21, 90) + 1 }, (_, i) => {
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
              slug: rescheduleTarget.slug,
              professional: rescheduleChair,
              services: serviceIds,
              period: reschedulePeriod,
              day,
            }),
          }))
        );
        result.push(...batch);
      }
      if (alive) setRescheduleDays(result);
    })()
      .catch((e) => alive && setRescheduleErr((e as Error).message))
      .finally(() => alive && setRescheduleBusy(false));

    return () => {
      alive = false;
    };
  }, [rescheduleTarget, shopInfo, reschedulePeriod, rescheduleChair, call]);

  async function confirmReschedule() {
    if (!rescheduleTarget || !rescheduleDay || !reschedulePeriod || !rescheduleSlot) return;
    setRescheduleBusy(true);
    setRescheduleErr('');
    try {
      await call('client_reschedule', {
        p_appointment: rescheduleTarget.id,
        p_day: rescheduleDay,
        p_period: reschedulePeriod,
        p_start: rescheduleSlot.start,
        p_professional: rescheduleSlot.professional || rescheduleChair || 'auto',
      });
      const token = await getClerkToken();
      void notifyAppointmentEvent(token, String(rescheduleTarget.id), 'booking_rescheduled');
      closeReschedule();
      N('Horário remarcado com sucesso! A barbearia foi avisada.');
      await load();
    } catch (e) {
      setRescheduleErr((e as Error).message);
    } finally {
      setRescheduleBusy(false);
    }
  }

  const periodRange = (p: string) => {
    if (!shopInfo?.cfg?.week) return '';
    const ranges = shopInfo.cfg.week
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
  ].filter((item) => periodRange(item.key));

  return (
    <main className="booking">
      <header className="booking-top">
        <Link className="brand" href="/">
          <BrandLogo variant="dark" height={31} />
        </Link>
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            try {
              sessionStorage.removeItem('kroner:convite');
              for (const k of Object.keys(sessionStorage)) {
                if (k.startsWith('booking:')) sessionStorage.removeItem(k);
              }
            } catch {}
            await signOut();
            location.assign('/');
          }}
        >
          <LogOut size={14} /> Sair
        </button>
      </header>

      <section className="booking-hero">
        <div className="booking-hero-main">
          <h1>Meus horários</h1>
          <p className="booking-location">
            <CalendarDays size={15} />
            <span>Uma conta. Todos os seus agendamentos na Kronner.</span>
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="notice danger">
          {error}
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}

      {busy ? (
        <div className="card">
          <p style={{ margin: 0 }}>Carregando seus horários…</p>
        </div>
      ) : !data.length ? (
        <div className="card empty">
          <span className="empty-icon">
            <Scissors size={24} />
          </span>
          <h2>Ainda não há agendamentos.</h2>
          <p>Abra o link enviado pela sua barbearia para escolher um horário.</p>
        </div>
      ) : (
        data
          .sort((a, b) => b.starts.localeCompare(a.starts))
          .map((a) => {
            const st = STATUS_BADGE[a.status as string] || STATUS_BADGE.booked;
            return (
              <article className="card" key={a.id}>
                <div className="split">
                  <h2>{a.shop_name}</h2>
                  <span className={'badge ' + st.cls}>{st.label}</span>
                </div>
                <p>
                  {new Date(a.starts).toLocaleString('pt-BR', { timeZone: a.timezone })} ·{' '}
                  {a.services.map((s: Row) => s.name).join(' + ')}
                </p>
                <strong>{money(a.price)}</strong>
                <div className="actions">
                  <Link className="btn primary" href={'/b/' + a.slug}>
                    Agendar novamente
                  </Link>
                  {a.status === 'booked' && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openReschedule(a)}
                      >
                        <RefreshCw size={14} /> Remarcar horário
                      </button>
                      <button
                        type="button"
                        className="btn danger-outline"
                        onClick={() => cancel(a.id)}
                      >
                        Cancelar horário
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })
      )}

      {rescheduleTarget && (
        <div className="overlay modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
          <section className="modal card" style={{ maxWidth: 560, width: '100%' }}>
            <div className="split">
              <div>
                <h2 id="reschedule-title" style={{ margin: 0 }}>Remarcar horário</h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                  {rescheduleTarget.shop_name} · {(rescheduleTarget.services || []).map((s: Row) => s.name).join(' + ')}
                </p>
              </div>
              <button type="button" className="close" aria-label="Fechar" onClick={closeReschedule}>
                <X size={18} />
              </button>
            </div>

            {rescheduleErr && (
              <div role="alert" className="notice danger" style={{ marginTop: 12 }}>
                {rescheduleErr}
              </div>
            )}

            {!shopInfo ? (
              <p style={{ margin: '16px 0' }}>Carregando horários disponíveis…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
                {shopInfo.professionals?.length > 1 && (
                  <label className="booking-chair-select" style={{ margin: 0 }}>
                    <span>
                      <User size={15} /> Profissional
                    </span>
                    <select
                      value={rescheduleChair}
                      onChange={(e) => {
                        setRescheduleChair(e.target.value);
                        setReschedulePeriod('');
                      }}
                    >
                      <option value="auto">Primeiro horário disponível</option>
                      {shopInfo.professionals.map((person: Row) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13.5 }}>1. Escolha o período</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {periodOptions.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className={'btn small ' + (reschedulePeriod === key ? 'primary' : '')}
                        onClick={() => setReschedulePeriod(key)}
                      >
                        <Icon size={14} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                {reschedulePeriod && (
                  <div>
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13.5 }}>2. Escolha o novo dia</p>
                    {rescheduleBusy && !rescheduleDays.length ? (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Consultando agenda…</p>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 160, overflowY: 'auto' }}>
                        {rescheduleDays
                          .filter((d) => (d.slots || []).length > 0)
                          .map((d) => {
                            const dt = new Date(d.day + 'T12:00:00Z');
                            const label = `${days[dt.getUTCDay()].slice(0, 3)}, ${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`;
                            return (
                              <button
                                key={d.day}
                                type="button"
                                className={'btn small ' + (rescheduleDay === d.day ? 'primary' : '')}
                                onClick={() => {
                                  setRescheduleDay(d.day);
                                  setRescheduleSlots(d.slots || []);
                                  setRescheduleSlot(null);
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        {!rescheduleBusy && rescheduleDays.every((d) => !(d.slots || []).length) && (
                          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                            Nenhum horário disponível neste período. Tente outro período.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {rescheduleDay && rescheduleSlots.length > 0 && (
                  <div>
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13.5 }}>3. Escolha o horário</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 150, overflowY: 'auto' }}>
                      {rescheduleSlots.map((sl: Row) => (
                        <button
                          key={sl.start}
                          type="button"
                          className={'btn small ' + (rescheduleSlot?.start === sl.start ? 'primary' : '')}
                          onClick={() => setRescheduleSlot(sl)}
                        >
                          <Clock size={13} /> {sl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={rescheduleBusy || !rescheduleSlot}
                    onClick={confirmReschedule}
                  >
                    {rescheduleBusy ? 'Salvando…' : 'Confirmar remarcação'}
                  </button>
                  <button type="button" className="btn" onClick={closeReschedule}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
