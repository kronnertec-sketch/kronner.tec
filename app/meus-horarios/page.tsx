'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, LogOut, Scissors } from 'lucide-react';
import { useApi } from '@/lib/supabase';
import { useAuth, useClerk } from '@clerk/react';
import { money } from '@/lib/domain';
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
  const { signOut } = useClerk();
  const [data, S] = useState<Row[]>([]),
    [error, E] = useState(''),
    [busy, B] = useState(true);

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
    try {
      await call('cancel_own', { id });
      await load();
    } catch (e) {
      E((e as Error).message);
    }
  }

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
                    <button
                      type="button"
                      className="btn danger-outline"
                      onClick={() => cancel(a.id)}
                    >
                      Cancelar horário
                    </button>
                  )}
                </div>
              </article>
            );
          })
      )}
    </main>
  );
}
