# Kroner — implementação do piloto

O PDR 1.4 e o PDF original NÃO foram modificados. Eles continuam como especificação futura.

## Decisão específica do piloto
- Supabase Auth com e-mail e senha no lugar do Clerk.
- Cadastro sem confirmação de e-mail, conforme pedido expresso. Exige desativar Confirm email nas configurações de Auth do projeto antes do teste de cadastro.
- Sem cobrança do SaaS ou integração de pagamentos.
- Identidade Kroner fixa; link estável por barbearia e conta única por cliente.

## Estado de implementação
Agenda online/manual, consulta de disponibilidade por duração e período, conflitos transacionais, clientes, finalização integral/parcial/pendente, taxas de cartão, recebimentos, despesas/aportes/retiradas, produtos, compras/vendas/perdas/uso interno, planos semanais, geração mensal de reservas e cobranças, suspensão manual, bloqueios, relatórios por datas e impressão, avisos internos, configuração inicial.

## Limites que ainda precisam ser fechados antes de considerar todo o PDR atendido
- Mensalistas: geração de cada mês pelo gestor; não há job automático nem recorrência quinzenal.
- Estoque: validade por produto, sem controle por lote e sem estorno completo de movimentação.
- Remarcação por formulário com confirmação do gestor; arrastar na agenda ainda não implementado.
- Feriados: lembretes de datas nacionais fixas; datas móveis e locais precisam de conferência e bloqueio manual.
- Relatório mostra fluxo de caixa e movimentos; ainda não apura margem por custo médio/lote.
- Notificações são calculadas ao abrir o painel; não há push, e-mail operacional ou WhatsApp.
- Política comercial de teste único, revisão de telefone repetido, cobrança e painel de suporte não estão ativos neste piloto gratuito.
- Não há recuperação de senha por e-mail nesta versão inicial; implementar antes de ampliar o público.
- Configuração de meios aceitos ainda usa os quatro métodos padrão.
- Mudanças de expediente não cancelam reservas; o gestor precisa revisar a agenda.
- O histórico das tabelas privadas não está disponível diretamente aos clientes; acesso exclusivamente por RPC com autorização explícita.

## Infraestrutura
Supabase projeto azbccqwjnzrzrhvnlncy, região São Paulo.
Vercel projeto kroner-piloto, id prj_hlqcqNMQeAzQAOyFZa0CO5poazpL.
Não reutiliza o banco nem a implantação Bruno Silva.

## Segurança
Não existe senha fixa, senha em texto claro, chave service_role no navegador ou autorização por nome de empresa/IP. O Supabase valida a sessão. Tabelas privadas sem concessão de leitura/escrita para anon/authenticated, RLS em todas elas, RPC autoriza cada operação e limita dados públicos. A função privada SECURITY DEFINER tem search_path vazio e valida auth.uid/owner antes de operações; somente consulta pública de disponibilidade é anônima. O wrapper público é SECURITY INVOKER.

## Execução
npm ci
npm test
npm run typecheck
npm run build
npm run dev

Copie .env.example para .env.local e informe somente URL/chave publicável do projeto. Migrações em supabase/migrations. Nunca incluir tokens de administração no Git.

## Verificação desta entrega
- Build Next.js e TypeScript: aprovados.
- 4 testes unitários aprovados.
- 11 verificações SQL transacionais aprovadas: disponibilidade/encerramento, reserva idempotente, colisão de horário, pagamento parcial/taxa, repetição de pagamento, compra/venda idempotente, estoque negativo, despesas por mês, mensalidade/reservas, isolamento entre barbearias, bloqueio anônimo.
- Inspeção visual: entrada e página inicial. Fluxo completo autenticado no navegador ainda não validado.
- Auditor do Supabase: 14 avisos informativos de RLS sem policy. Intencional neste desenho: tabelas privadas não têm grants aos clientes; operações passam pela RPC autorizada. Isso não equivale a uma auditoria independente de segurança.
- Deployment Vercel dpl_yGPs9RRbQhsVcGvAZmsZYKyNW827: READY; https://kroner-piloto.vercel.app. A API retornou ambiente production apesar do pedido preview; proteção de acesso do projeto foi preservada.
- GitHub: repositório local preparado, ainda NÃO publicado. Conector retorna zero repositórios acessíveis; criação pelo painel depende de login.
- Cadastro Supabase sem confirmação: ainda depende de configurar o projeto; navegador pediu autenticação e a solicitação segura expirou.

Não considerar esta entrega cumprimento integral do PDR. Concluir os pontos de integração e validar ponta a ponta antes do uso com dados reais.


## Correções de usabilidade — 29/10/2026
- Configurações preservam campos vazios e vírgulas durante edição; conversão e validação só ao salvar.
- Acesso obrigatório antes da seleção no link da barbearia; conta existente continua reutilizável.
- Cadastro envia emailRedirectTo para /auth/retorno com destino seguro. Callback consome PKCE via inicialização do SDK, retorna ao destino e oferece login quando aberto em outro navegador.
- Supabase precisa de Site URL https://kroner-piloto.vercel.app e Redirect URLs https://kroner-piloto.vercel.app/auth/retorno**. Configuração remota ainda não verificada por falta de sessão no painel. Não afirmar confirmação de e-mail corrigida ponta a ponta.
- Ajustes de largura mínima, toque, tabelas, modais e períodos em telas pequenas. PDR preservado.

## Confirmação por código — preparada, ainda não publicada
A confirmação de novos cadastros usa signUp(email,password), verifyOtp(email,token,type=email) e resend(type=signup). Entradas futuras continuam com senha. A tela guarda apenas e-mail/destino na sessionStorage por até 24 horas para sobreviver a recarregamento; não guarda senha nem código. Falhas não liberam acesso. Reenvio tem pausa de 60 segundos na interface, além dos limites do Supabase.
Antes de publicar esta revisão, atualizar Authentication > Email Templates > Confirm signup no projeto azbccqwjnzrzrhvnlncy com supabase/templates/confirm-signup.html e assunto “Seu código de confirmação — Kroner”. Manter confirmação habilitada. Não alterar templates de recuperação de senha nem Magic Link. Testar recebimento, código errado/expirado, código válido, reenvio, refresh e destino de duas barbearias. A configuração do painel continua bloqueada por autenticação; não publicar a tela que exige código enquanto os e-mails só contêm links. PDR intacto.
