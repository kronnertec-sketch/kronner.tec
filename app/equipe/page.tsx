'use client';
import { BrandLogo } from '@/components/BrandLogo';
import Link from 'next/link';
import { useAuth, useClerk, useSession, useUser } from '@clerk/react';
import { useCallback, useEffect, useState } from 'react';
import { LogOut, X } from 'lucide-react';
import { useApi } from '@/lib/supabase';

type PendingInvite = { id: string; shopName: string; role: string; expires: string };
const roles: Record<string, string> = {
  owner: 'Conta principal',
  partner: 'Sócio',
  employee: 'Funcionário',
};

export default function Team() {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const { session, isLoaded: sessionLoaded } = useSession();
  const { user: clerkUser } = useUser();
  const { signOut } = useClerk();
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [access, setAccess] = useState('');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    const identity = await api('team:identity');
    if (identity.role) {
      location.replace('/painel');
      return;
    }
    setAccess(identity.revoked ? 'revoked' : 'none');
    const pending = await api('team:pending_invites').catch(() => []);
    setPendingInvites(Array.isArray(pending) ? pending : []);
  }, [api]);

  useEffect(() => {
    if (!isLoaded || !sessionLoaded) return;
    const hashToken = location.hash.slice(1).trim();
    const queryToken = new URLSearchParams(location.search).get('convite')?.trim() || '';
    const token = /^[a-f0-9]{64}$/i.test(hashToken)
      ? hashToken
      : /^[a-f0-9]{64}$/i.test(queryToken)
        ? queryToken
        : '';
    if (token) {
      sessionStorage.setItem('kroner:convite', token);
      history.replaceState(null, '', '/equipe');
    }
    if (!isSignedIn) {
      location.replace('/entrar?mode=signup&next=/equipe');
      return;
    }
    if (!session) return;
    setInvite(sessionStorage.getItem('kroner:convite') || '');
    refresh().catch((e) => setError((e as Error).message));
  }, [refresh, isLoaded, sessionLoaded, isSignedIn, session?.id]);

  async function run(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await api('team:' + action, payload);
      if (action === 'accept') {
        sessionStorage.removeItem('kroner:convite');
        setInvite('');
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function discardStoredInvite() {
    try {
      sessionStorage.removeItem('kroner:convite');
    } catch {}
    setInvite('');
    setError('');
  }

  const email = clerkUser?.primaryEmailAddress?.emailAddress || '';

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
            await signOut();
            location.replace('/entrar?mode=signup&next=/equipe');
          }}
        >
          <LogOut size={14} /> Trocar conta
        </button>
      </header>

      <section className="booking-hero">
        <div className="booking-hero-main">
          <h1>Convite de equipe</h1>
          <p className="booking-location">
            <span>
              {email
                ? `Conectado como ${email}. Aceite seu convite para acessar o painel da barbearia.`
                : 'Entre com o e-mail convidado para aceitar o acesso à barbearia.'}
            </span>
          </p>
        </div>
      </section>

      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}

      {invite && (
        <section className="card">
          <div className="split">
            <h2>Convite por link</h2>
            <button
              type="button"
              className="btn small"
              onClick={discardStoredInvite}
              title="Descartar este link"
            >
              <X size={14} /> Descartar
            </button>
          </div>
          <p>
            Use a conta do mesmo e-mail que recebeu o convite. Se você entrou com outro e-mail,
            clique em <strong>Trocar conta</strong> acima.
          </p>
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              className="btn primary"
              onClick={() => run('accept', { token: invite })}
            >
              {busy ? 'Validando…' : 'Aceitar convite'}
            </button>
          </div>
        </section>
      )}

      {pendingInvites.length > 0 && (
        <section className="card">
          <h2>Convites pendentes para seu e-mail</h2>
          {pendingInvites.map((item) => (
            <article className="line" key={item.id}>
              <div>
                <b>{item.shopName}</b>
                <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
                  {roles[item.role] || item.role}
                </span>
              </div>
              <div className="actions" style={{ margin: 0 }}>
                <button
                  type="button"
                  disabled={busy}
                  className="btn primary"
                  onClick={() => run('accept', { id: item.id })}
                >
                  Aceitar convite
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn"
                  onClick={() => run('decline', { id: item.id })}
                >
                  Recusar
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {access === 'revoked' && (
        <div className="card">
          <p style={{ margin: 0 }}>Seu acesso à equipe foi desativado pelo responsável da barbearia.</p>
        </div>
      )}

      {access === 'none' && !invite && pendingInvites.length === 0 && (
        <div className="card">
          <p style={{ margin: '0 0 12px' }}>
            Nenhum convite ativo foi encontrado para <strong>{email || 'esta conta'}</strong>.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13.5 }}>
            Abra o link de convite enviado pelo responsável da barbearia ou clique em{' '}
            <strong>Trocar conta</strong> para entrar com o e-mail convidado.
          </p>
        </div>
      )}
    </main>
  );
}
