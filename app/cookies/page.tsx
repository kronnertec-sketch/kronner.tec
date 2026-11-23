'use client';

import { Cookie } from 'lucide-react';
import { LegalShell } from '@/components/LegalShell';
import { openCookieSettings } from '@/lib/consent';

export default function CookiesPage() {
  return (
    <LegalShell
      title="Política de Cookies"
      subtitle="Entenda quais cookies e armazenamentos locais a Kroner utiliza e gerencie seu consentimento a qualquer momento."
      updatedAt="23 de novembro de 2026"
      current="cookies"
    >
      <h2>1. O que são cookies e armazenamento local</h2>
      <p>
        Cookies e registros locais (<em>localStorage</em> / <em>sessionStorage</em>) são pequenos
        arquivos gravados no seu navegador para manter sua sessão segura, evitar que você perca um
        agendamento em andamento e guardar sua escolha de privacidade.
      </p>

      <h2>2. Cookies estritamente necessários (sempre ativos)</h2>
      <ul>
        <li>
          <strong>Autenticação e segurança (Clerk):</strong> mantêm sua sessão autenticada e
          protegem o acesso contra fraudes e CSRF.
        </li>
        <li>
          <strong>Andamento do agendamento (sessionStorage):</strong> preserva temporariamente os
          serviços escolhidos caso o cliente precise fazer login antes de confirmar o horário.
        </li>
        <li>
          <strong>Preferência de privacidade e avisos internos (localStorage):</strong> registra
          sua decisão sobre cookies e evita repetir pop-ups de feriados já visualizados no mesmo
          dia.
        </li>
      </ul>

      <h2>3. Cookies opcionais de medição e analytics</h2>
      <p>
        A Kroner <strong>não ativa nenhum script de medição opcional</strong> antes do seu
        consentimento explícito no aviso de cookies. Caso você aceite, podemos coletar métricas
        agregadas de navegação para melhorar a velocidade e a usabilidade das telas, sem venda de
        dados e sem anúncios de terceiros.
      </p>

      <h2>4. Como alterar sua escolha</h2>
      <p>
        Você pode revisar, aceitar ou recusar cookies opcionais a qualquer momento clicando no
        botão abaixo:
      </p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={openCookieSettings}>
          <Cookie size={15} aria-hidden="true" /> Alterar minhas preferências de cookies
        </button>
      </div>
    </LegalShell>
  );
}
