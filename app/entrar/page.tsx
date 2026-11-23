'use client';
import { useState, useEffect } from 'react';
import { SignIn, SignUp, useAuth } from '@clerk/react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, CheckCircle2, ShieldCheck, Wallet } from 'lucide-react';
import { safeReturn } from '@/lib/domain';
import { BrandLogo } from '@/components/BrandLogo';

export default function Login() {
  const [signup, S] = useState(false),
    [next, N] = useState('/painel'),
    [ready, R] = useState(false);
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    N(safeReturn(q.get('next')));
    S(q.get('mode') === 'signup');
    R(true);
  }, []);

  useEffect(() => {
    if (ready && isLoaded && isSignedIn) location.replace(next);
  }, [ready, isLoaded, isSignedIn, next]);

  const query = '&next=' + encodeURIComponent(next);
  const isBookingReturn = next.startsWith('/b/') || next.startsWith('/meus-horarios');

  return (
    <main className="auth-shell">
      <aside className="auth-brand-pane" aria-label="Sobre a Kronner">
        <div className="auth-brand-top">
          <Link href="/" className="brand" aria-label="Voltar para a página inicial">
            <BrandLogo variant="light" height={32} />
          </Link>
          <Link href="/" className="auth-back-link">
            <ArrowLeft size={14} /> Início
          </Link>
        </div>

        <div className="auth-brand-body">
          <h1>
            {isBookingReturn
              ? 'Seu horário reservado em poucos toques.'
              : signup
                ? 'Abra o comando da sua barbearia.'
                : 'De volta ao ritmo da cadeira.'}
          </h1>
          <p>
            {isBookingReturn
              ? 'Sua conta Kronner vale para todas as barbearias parceiras e mantém seus agendamentos sempre à mão.'
              : 'Agenda por cadeira, link público para clientes, feriados pelo CEP e caixa com PDV no mesmo lugar.'}
          </p>

          <ul className="auth-highlights">
            <li>
              <span className="auth-hl-icon">
                <CalendarDays size={16} />
              </span>
              <div>
                <strong>Agenda em tempo real</strong>
                <small>Horários sincronizados com intervalo de segurança.</small>
              </div>
            </li>
            <li>
              <span className="auth-hl-icon is-brass">
                <Wallet size={16} />
              </span>
              <div>
                <strong>Caixa, PDV e comissões</strong>
                <small>Entradas líquidas, taxas e fechamento diário organizados.</small>
              </div>
            </li>
            <li>
              <span className="auth-hl-icon">
                <ShieldCheck size={16} />
              </span>
              <div>
                <strong>Acesso individual e seguro</strong>
                <small>Verificação por código sem compartilhar senhas.</small>
              </div>
            </li>
          </ul>
        </div>

        <div className="auth-brand-footer">
          <CheckCircle2 size={14} />
          <span>Kronner · Tempo para o seu talento.</span>
        </div>
      </aside>

      <section className="auth-form-pane">
        <div className="auth-mobile-header">
          <Link href="/" className="brand">
            <BrandLogo variant="dark" height={30} />
          </Link>
          <Link href="/" className="text-btn">
            Voltar
          </Link>
        </div>

        <div className="auth-form-inner">
          {!ready || !isLoaded ? (
            <div className="auth-status-card" role="status">
              <div className="auth-spinner" aria-hidden="true" />
              <p>Carregando acesso seguro…</p>
            </div>
          ) : isSignedIn ? (
            <div className="auth-status-card" role="status">
              <div className="auth-spinner" aria-hidden="true" />
              <p>Entrando na sua conta…</p>
            </div>
          ) : (
            <>
              <div className="auth-intro">
                <h2>{signup ? 'Criar minha conta' : 'Acessar minha conta'}</h2>
                <p>
                  {signup
                    ? 'Confirme seu e-mail com o código enviado para ativar seu acesso.'
                    : 'Entre para continuar exatamente de onde parou.'}
                </p>
              </div>

              <div className="auth-clerk-wrap">
                {signup ? (
                  <SignUp
                    routing="hash"
                    signInUrl={'/entrar?mode=signin' + query}
                    forceRedirectUrl={next}
                  />
                ) : (
                  <SignIn
                    routing="hash"
                    signUpUrl={'/entrar?mode=signup' + query}
                    forceRedirectUrl={next}
                  />
                )}
              </div>

              <div className="auth-notes">
                <small>
                  Ao continuar, você concorda com os{' '}
                  <Link href="/termos">Termos de Serviço</Link> e a{' '}
                  <Link href="/privacidade">Política de Privacidade (LGPD)</Link>. Coletamos apenas
                  os dados essenciais para seu acesso individual.
                </small>
                <small>
                  Já usava a Kronner antes? No primeiro acesso pelo Clerk, crie sua conta com o
                  mesmo e-mail e confirme o código para recuperar seus dados.
                </small>
                <small>Seu acesso é individual. Não compartilhe sua senha ou código.</small>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
