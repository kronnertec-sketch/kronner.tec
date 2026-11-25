'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, MessageSquareQuote, Sparkles, X } from 'lucide-react';

type WhatsappShortcutCardProps = {
  done: boolean;
  onOpenTutorial: () => void;
  onMarkDone: () => void;
};

export function WhatsappShortcutCard({
  done,
  onOpenTutorial,
  onMarkDone,
}: WhatsappShortcutCardProps) {
  if (done) return null;

  return (
    <section
      className="card kr-install-card kr-shortcut-card"
      aria-label="Tutorial de atalho rápido no WhatsApp"
    >
      <div className="kr-install-head">
        <div className="kr-install-title-wrap">
          <span className="kr-install-icon kr-shortcut-icon" aria-hidden="true">
            <MessageSquareQuote size={20} />
          </span>
          <div>
            <div className="kr-install-badges">
              <span className="kr-device-pill">
                <Sparkles size={12} /> Dica de agilidade · WhatsApp
              </span>
            </div>
            <h3>Envie seu link de agendamento em 2 segundos</h3>
            <p className="kr-install-sub">
              Configure o atalho <span className="mono">/agendamento</span> (WhatsApp Business) ou{' '}
              <span className="mono">@@agendar</span> (teclado do iPhone/Android) para preencher a
              mensagem completa com seu link automaticamente. Assim que concluir, toque em{' '}
              <strong>OK, já configurei</strong> para remover este aviso.
            </p>
          </div>
        </div>
      </div>

      <div className="kr-shortcut-actions">
        <button type="button" className="btn primary" onClick={onOpenTutorial}>
          Abrir tutorial passo a passo <ArrowRight size={15} />
        </button>
        <button type="button" className="btn" onClick={onMarkDone}>
          <CheckCircle2 size={15} /> OK, já configurei
        </button>
      </div>
    </section>
  );
}

type WhatsappShortcutPromptProps = {
  identity: string;
  day: string;
  done: boolean;
  blocked?: boolean;
  onOpenTutorial: () => void;
  onMarkDone: () => void;
};

export function WhatsappShortcutPrompt({
  identity,
  day,
  done,
  blocked = false,
  onOpenTutorial,
  onMarkDone,
}: WhatsappShortcutPromptProps) {
  const [visible, setVisible] = useState(false);
  const snoozeKey = `kroner:whatsapp-shortcut-snooze:${identity}`;

  useEffect(() => {
    if (done || blocked || !identity) {
      setVisible(false);
      return;
    }
    try {
      if (localStorage.getItem(snoozeKey) === day || sessionStorage.getItem(snoozeKey) === day) {
        return;
      }
      localStorage.setItem(snoozeKey, day);
      sessionStorage.setItem(snoozeKey, day);
    } catch {}
    setVisible(true);
  }, [done, blocked, identity, snoozeKey, day]);

  if (!visible || done || blocked) return null;

  return (
    <div className="overlay modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-shortcut-heading"
        className="modal card"
      >
        <div className="split">
          <h2 id="whatsapp-shortcut-heading">Atalho rápido no WhatsApp</h2>
          <button
            type="button"
            className="close"
            aria-label="Fechar"
            onClick={() => setVisible(false)}
          >
            <X size={16} />
          </button>
        </div>
        <p>
          Você sabia que pode mandar o link da sua agenda no WhatsApp digitando apenas um atalho
          curto? Já deixamos a mensagem pronta e o tutorial completo para você configurar:
        </p>
        <ul>
          <li>
            <strong>WhatsApp Business:</strong> digite <span className="mono">/agendamento</span> e
            envie na hora.
          </li>
          <li>
            <strong>iPhone e Android:</strong> cadastre <span className="mono">@@agendar</span> na
            substituição de texto do teclado.
          </li>
          <li>
            Quando finalizar, clique em <strong>OK, já configurei</strong> para ocultar este aviso
            das notificações e configurações.
          </li>
        </ul>
        <div className="actions">
          <button
            type="button"
            autoFocus
            className="btn primary"
            onClick={() => {
              setVisible(false);
              onOpenTutorial();
            }}
          >
            Abrir tutorial agora
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setVisible(false);
              onMarkDone();
            }}
          >
            <CheckCircle2 size={15} /> OK, já configurei
          </button>
          <button type="button" className="btn ghost" onClick={() => setVisible(false)}>
            Lembrar depois
          </button>
        </div>
      </section>
    </div>
  );
}
