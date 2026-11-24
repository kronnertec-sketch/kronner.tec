import type { Metadata } from 'next';
import { LegalShell } from '@/components/LegalShell';

export const metadata: Metadata = {
  title: 'Política de Privacidade (LGPD) · Kronner',
  description:
    'Como a Kronner coleta, utiliza, armazena e protege dados pessoais em conformidade com a LGPD (Lei nº 13.709/2018).',
};

export default function PrivacidadePage() {
  return (
    <LegalShell
      title="Política de Privacidade (LGPD)"
      subtitle="Transparência sobre os dados estritamente necessários para operar sua barbearia e confirmar agendamentos, em conformidade com a Lei nº 13.709/2018."
      updatedAt="23 de novembro de 2026"
      current="privacidade"
    >
      <h2>1. Princípio da minimização de dados</h2>
      <p>
        A Kronner coleta apenas os dados estritamente necessários para prestar o serviço de
        agendamento e gestão de barbearias. Não solicitamos CPF de clientes finais para agendar,
        não vendemos dados pessoais e não enviamos spam por WhatsApp.
      </p>

      <h2>2. Quais dados coletamos e para qual finalidade</h2>
      <ul>
        <li>
          <strong>Conta de acesso (barbeiros, equipe e clientes):</strong> e-mail e identificador
          único de autenticação, utilizados exclusivamente para login individual e recuperação de
          acesso.
        </li>
        <li>
          <strong>Agendamento de clientes finais:</strong> nome e telefone com DDD, utilizados
          para identificar o atendimento na barbearia escolhida e permitir contato direto caso haja
          imprevisto.
        </li>
        <li>
          <strong>Cadastro da barbearia:</strong> nome do estabelecimento, profissional
          responsável, telefone de contato, CEP, endereço, cidade, UF, expediente, serviços e
          lançamentos gerenciais (financeiro, estoque e comissões). O CEP é usado para preencher o
          endereço e identificar feriados nacionais, estaduais e municipais da localidade.
        </li>
        <li>
          <strong>Assinatura da barbearia:</strong> processada diretamente pela Stripe. A Kronner
          não coleta nem armazena números de cartão de crédito ou códigos de segurança.
        </li>
      </ul>

      <h2>3. Papéis segundo a LGPD (Controlador e Operador)</h2>
      <p>
        Em relação aos dados de cadastro da barbearia e da conta na plataforma, a Kronner atua como
        Controladora. Em relação aos dados dos clientes finais agendados em cada estabelecimento, a
        barbearia atua como Controladora e a Kronner atua como Operadora, tratando os dados sob as
        configurações do estabelecimento.
      </p>

      <h2>4. Bases legais utilizadas</h2>
      <ul>
        <li>
          <strong>Execução de contrato (Art. 7º, V):</strong> funcionamento da agenda, gestão da
          barbearia e confirmação de horários solicitados pelo cliente.
        </li>
        <li>
          <strong>Cumprimento de obrigação legal (Art. 7º, II):</strong> guarda de registros de
          acesso e faturamento quando exigido por lei.
        </li>
        <li>
          <strong>Consentimento (Art. 7º, I):</strong> cookies opcionais de medição/melhoria,
          ativados somente se autorizados expressamente pelo titular.
        </li>
      </ul>

      <h2>5. Operadores e infraestrutura utilizada</h2>
      <p>
        Para manter o sistema disponível e seguro, utilizamos provedores especializados com
        criptografia em trânsito (HTTPS/TLS):
      </p>
      <ul>
        <li>
          <strong>Clerk:</strong> autenticação segura por e-mail e código/login social.
        </li>
        <li>
          <strong>Supabase (PostgreSQL):</strong> armazenamento de dados com isolamento por
          estabelecimento e Row Level Security (RLS) ativado em todas as tabelas privadas.
        </li>
        <li>
          <strong>Stripe:</strong> gestão de assinaturas, faturas e pagamentos da barbearia.
        </li>
        <li>
          <strong>Vercel:</strong> hospedagem da aplicação web.
        </li>
        <li>
          <strong>ViaCEP / BrasilAPI:</strong> consultas pontuais de endereço por CEP e calendário
          público de feriados, sem envio de dados pessoais de clientes.
        </li>
        <li>
          <strong>Google Fonts:</strong> entrega otimizada de fontes tipográficas da interface
          (com tráfego padrão de requisição HTTP, sem vínculo a perfil de cliente).
        </li>
      </ul>

      <h2>6. Direitos do titular (Art. 18 da LGPD)</h2>
      <p>
        Você pode solicitar a qualquer momento: confirmação da existência de tratamento, acesso aos
        seus dados, correção de dados incompletos ou desatualizados, eliminação de dados tratados
        com consentimento, portabilidade ou revogação de consentimento de cookies.
      </p>

      <h2>7. Canal do Encarregado (DPO) e contato</h2>
      <p>
        Para exercer qualquer direito previsto na LGPD ou tirar dúvidas sobre privacidade, envie um
        e-mail para <strong>kronner.tec@gmail.com</strong> com o assunto{' '}
        <em>&ldquo;Privacidade / LGPD&rdquo;</em>. Respondemos em prazo razoável conforme a
        legislação brasileira.
      </p>
    </LegalShell>
  );
}
