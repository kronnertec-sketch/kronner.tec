import type { Metadata } from 'next';
import { LegalShell } from '@/components/LegalShell';

export const metadata: Metadata = {
  title: 'Política de Reembolso e Cancelamento · Kroner',
  description:
    'Regras transparentes sobre período gratuito de 15 dias, direito de arrependimento (7 dias — CDC) e cancelamento da assinatura Kroner.',
};

export default function ReembolsoPage() {
  return (
    <LegalShell
      title="Política de Reembolso e Cancelamento"
      subtitle="Condições transparentes para teste gratuito, arrependimento dentro do Código de Defesa do Consumidor e cancelamento da assinatura."
      updatedAt="23 de novembro de 2026"
      current="reembolso"
    >
      <h2>1. Teste gratuito de 15 dias (sem cartão)</h2>
      <p>
        Toda nova barbearia conta com <strong>15 dias gratuitos</strong> para avaliar o sistema sem
        necessidade de cadastrar cartão de crédito inicialmente. Caso decida não contratar após o
        período de teste, nenhuma cobrança será realizada.
      </p>

      <h2>2. Direito de arrependimento (7 dias — Art. 49 do CDC)</h2>
      <p>
        Após a primeira cobrança da assinatura contratada online, você tem direito ao
        arrependimento em até <strong>7 (sete) dias corridos</strong>, com{' '}
        <strong>reembolso integral</strong> do valor pago, sem burocracia e sem multa. Basta
        solicitar pelo e-mail <strong>kronner.tec@gmail.com</strong> informando o e-mail da conta
        titular.
      </p>

      <h2>3. Cancelamento a qualquer momento</h2>
      <p>
        Você pode cancelar a assinatura ou gerenciar seu cartão diretamente no painel da barbearia
        em <strong>Configurações → Cartão e faturas</strong> (Portal do Cliente Stripe). O
        cancelamento interrompe a próxima renovação mensal sem taxa de fidelidade ou multa, e o
        acesso permanece ativo até o final do ciclo já pago.
      </p>

      <h2>4. Ajuste de cadeiras adicionais (pró-rata)</h2>
      <p>
        Ao adicionar ou remover cadeiras extras (R$ 35,90/mês por cadeira), a Stripe calcula
        automaticamente o ajuste proporcional (pró-rata) referente aos dias restantes do ciclo de
        faturamento atual.
      </p>

      <h2>5. Prazo de estorno</h2>
      <p>
        Uma vez confirmado o reembolso elegível, o estorno é solicitado imediatamente via Stripe. O
        prazo de visualização na fatura depende da administradora do cartão (em geral entre 5 e 10
        dias úteis).
      </p>

      <h2>6. Serviços agendados nas barbearias</h2>
      <p>
        Os pagamentos de cortes, barbas e produtos são feitos diretamente à barbearia escolhida
        pelo cliente final. Eventuais pedidos de reembolso ou remarcação de atendimento devem ser
        tratados diretamente com o estabelecimento.
      </p>
    </LegalShell>
  );
}
