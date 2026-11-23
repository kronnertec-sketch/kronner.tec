import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/LegalShell';

export const metadata: Metadata = {
  title: 'Termos de Serviço · Kroner',
  description:
    'Condições gerais de uso do sistema Kroner para barbearias, profissionais e clientes finais.',
};

export default function TermosPage() {
  return (
    <LegalShell
      title="Termos de Serviço"
      subtitle="Regras claras sobre o uso da plataforma Kroner por barbearias, equipes e clientes."
      updatedAt="23 de novembro de 2026"
      current="termos"
    >
      <h2>1. Objeto do serviço</h2>
      <p>
        A Kroner é uma plataforma web de agendamento online e gestão operacional voltada para
        barbearias, incluindo agenda por cadeira, link público de reservas, controle de feriados,
        caixa/PDV, comissões, clientes mensalistas e controle opcional de estoque.
      </p>

      <h2>2. Conta individual e responsabilidades</h2>
      <ul>
        <li>
          O acesso à Kroner é individual e intransferível. O usuário é responsável por manter o
          sigilo de sua conta e códigos de verificação.
        </li>
        <li>
          A barbearia titular é responsável pela veracidade das informações publicadas em seu link
          de agendamento (nome, endereço, expediente, preços, duração dos serviços e política de
          cancelamento) e pelas permissões concedidas a sócios e funcionários.
        </li>
      </ul>

      <h2>3. Escopo gerencial e financeiro (sem promessas irreais)</h2>
      <p>
        Os relatórios financeiros, taxas de cartão, comissões e fechamento de caixa da Kroner têm
        caráter exclusivamente <strong>gerencial</strong>. A Kroner <strong>não</strong> calcula
        impostos, não emite nota fiscal e não substitui assessoria contábil ou jurídica.
      </p>
      <p>
        Os pagamentos pelos serviços prestados pela barbearia (corte, barba, produtos) são
        acertados diretamente entre cliente e estabelecimento. A Kroner não intermedia nem retém
        valores pagos pelos clientes finais.
      </p>

      <h2>4. Feriados e avisos internos</h2>
      <p>
        Os avisos de feriados e vencimentos são auxiliares e exibidos dentro do painel. Cabe ao
        responsável pela barbearia conferir a legislação municipal/estadual vigente e confirmar se
        haverá expediente em cada data. A Kroner não envia mensagens automáticas pelo WhatsApp em
        nome da barbearia.
      </p>

      <h2>5. Assinatura, teste gratuito e cancelamento</h2>
      <p>
        O Plano Principal inclui 1 cadeira pelo valor de R$ 99,90/mês, com 15 dias gratuitos sem
        exigência de cartão no início. Cadeiras adicionais custam R$ 35,90/mês com cobrança
        proporcional (pró-rata). Regras completas de cancelamento e reembolso estão na{' '}
        <Link href="/reembolso">Política de Reembolso</Link>.
      </p>

      <h2>6. Uso adequado e disponibilidade</h2>
      <p>
        É proibido utilizar a plataforma para fins ilícitos, envio de spam, tentativa de acesso não
        autorizado ou sobrecarga proposital do serviço. Empregamos boas práticas técnicas para
        manter a disponibilidade contínua, podendo realizar manutenções programadas quando
        necessário.
      </p>

      <h2>7. Contato e foro</h2>
      <p>
        Dúvidas sobre estes Termos podem ser enviadas para{' '}
        <strong>kronner.tec@gmail.com</strong>. Estes Termos são regidos pela legislação da
        República Federativa do Brasil.
      </p>
    </LegalShell>
  );
}
