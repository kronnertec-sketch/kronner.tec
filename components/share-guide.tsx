'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

type ShareGuideProps = {
  url: string;
  shortcutDone?: boolean;
  onMarkShortcutDone?: () => void;
};

export default function ShareGuide({
  url,
  shortcutDone = false,
  onMarkShortcutDone,
}: ShareGuideProps) {
  const [model, M] = useState('');
  const [status, S] = useState('');
  const message = `Fala, meu parceiro! 💈 Agora você pode agendar seu horário diretamente pela minha agenda online, sem precisar esperar eu responder! 📅 Escolha o melhor horário aqui: ${url}\n\nSe preferir, pode continuar marcando comigo por aqui normalmente! 🤝`;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      S('Copiado! Agora cole no seu celular.');
    } catch {
      S('Não foi possível copiar automaticamente. Selecione o texto abaixo e copie.');
    }
  }

  const youtube = (query: string) =>
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);

  return (
    <>
      <div className="notice danger">
        <strong>Importante: facilite o agendamento pelo WhatsApp.</strong>
        <p>
          Configure um atalho para inserir sua mensagem sem precisar escrever tudo novamente. Você
          digita o atalho, confere a mensagem e toca em enviar. Não é uma resposta automática a quem
          manda “Oi”.
        </p>
      </div>

      {onMarkShortcutDone && (
        <div className={`card kr-shortcut-confirm-bar ${shortcutDone ? 'is-done' : ''}`}>
          <div>
            <strong>
              {shortcutDone
                ? 'Atalho rápido do WhatsApp marcado como configurado'
                : 'Já terminou de configurar seu atalho no celular ou WhatsApp Business?'}
            </strong>
            <p>
              {shortcutDone
                ? 'O aviso já foi removido das suas notificações e configurações. Você pode consultar este tutorial aqui sempre que precisar.'
                : 'Clique em OK assim que cadastrar o atalho para ocultar o lembrete das notificações e configurações.'}
            </p>
          </div>
          {shortcutDone ? (
            <span className="kr-saved-pill">
              <CheckCircle2 size={14} /> Configurado
            </span>
          ) : (
            <button type="button" className="btn primary" onClick={onMarkShortcutDone}>
              <CheckCircle2 size={15} /> OK, já configurei o atalho
            </button>
          )}
        </div>
      )}

      <section className="card">
        <h2>Sua mensagem pronta</h2>
        <p>
          O link abaixo já é o da sua barbearia. Se usar o modelo em outro lugar, substitua apenas o
          link.
        </p>
        <label>
          Mensagem para copiar
          <textarea rows={7} readOnly value={message} style={{ width: '100%' }} />
        </label>
        <div className="actions">
          <button className="btn primary" onClick={() => copy(message)}>
            Copiar mensagem com meu link
          </button>
          <button className="btn" onClick={() => copy(url)}>
            Copiar só o link
          </button>
        </div>
        <p role="status">{status}</p>
      </section>

      <section className="card">
        <h2>No iPhone</h2>
        <ol>
          <li>Copie a mensagem acima.</li>
          <li>Abra Ajustes → Geral → Teclado → Substituição de Texto → +.</li>
          <li>
            Em “Frase”, cole a mensagem. Em “Atalho”, use <strong>@@agendar</strong>.
          </li>
          <li>
            Salve. No WhatsApp, digite o atalho e aceite a substituição sugerida pelo teclado.
          </li>
          <li>Confira o texto e envie para o cliente.</li>
        </ol>
        <a
          className="btn"
          href={youtube('iPhone substituição de texto atalho mensagem WhatsApp')}
          target="_blank"
          rel="noreferrer"
        >
          Buscar tutorial no YouTube
        </a>
      </section>

      <section className="card">
        <h2>No Android</h2>
        <div className="notice">
          <strong>Os menus variam conforme a marca, o modelo e o teclado.</strong>
          <p>
            Se seu aparelho não tiver o mesmo caminho do vídeo, pesquise pelo modelo exato e pelo
            teclado utilizado. Você também pode copiar a mensagem diretamente nesta página.
          </p>
        </div>
        <p>
          Procure nas configurações do teclado por “Atalhos de texto” ou “Dicionário pessoal”.
          Cadastre a mensagem e o atalho. Alguns teclados limitam o tamanho do texto.
        </p>
        <label>
          Marca e modelo do seu celular
          <input
            value={model}
            onChange={e => M(e.target.value)}
            placeholder="Ex.: Samsung Galaxy A54"
            maxLength={100}
          />
        </label>
        <a
          className="btn"
          href={youtube(
            `${model.trim() || 'Android'} atalho de texto mensagem pronta WhatsApp teclado`
          )}
          target="_blank"
          rel="noreferrer"
        >
          Buscar vídeos para meu celular
        </a>
        <small>Este botão abre uma busca no YouTube; os vídeos são de terceiros.</small>
      </section>

      <section className="card">
        <h2>No WhatsApp Business: /agendamento</h2>
        <p>Salve uma resposta rápida para inserir a mensagem dentro da conversa.</p>
        <ol>
          <li>Copie sua mensagem com o link acima.</li>
          <li>Abra o WhatsApp Business e procure Ferramentas comerciais → Respostas rápidas.</li>
          <li>Toque em adicionar (+) e cole o texto no campo da mensagem.</li>
          <li>
            No campo de atalho, cadastre <strong>agendamento</strong> e salve.
          </li>
          <li>
            Na conversa com o cliente, digite <strong>/agendamento</strong> e selecione a resposta
            salva.
          </li>
          <li>Confira o texto e toque em enviar.</li>
        </ol>
        <p>
          O atalho com barra pertence ao WhatsApp Business. No WhatsApp comum, use a substituição de
          texto do celular ensinada acima.
        </p>
        <a
          className="btn"
          href="https://faq.whatsapp.com/1791149784551042/?cms_platform=android&locale=pt_BR"
          target="_blank"
          rel="noreferrer"
        >
          Guia oficial de respostas rápidas
        </a>
        <p>
          A Kronner não acessa suas conversas nem envia mensagens. Você mantém o controle do
          atendimento.
        </p>
      </section>
    </>
  );
}
