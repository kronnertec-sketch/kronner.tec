# Kroner

Aplicação Next.js/Node.js + Supabase para gestão de barbearias.

Especificação do produto em docs/Especificacao_V6.pdf. A pasta docs também preserva o histórico das versões anteriores.

## Desenvolver
1. Node.js 24 e npm.
2. `npm ci`.
3. Preencha `.env.local` usando `.env.example`.
4. Aplique as migrações na ordem em `supabase/migrations` no projeto dedicado.
5. Esta versão usa Clerk e está publicada em https://kroner-barbearias.vercel.app. Para reproduzir a configuração, ative Third-Party Auth / Clerk no Supabase, configure as claims `role: authenticated`, `email: {{user.primary_email_address}}`, `email_verified: {{user.email_verified}}` no Clerk e aplique a migração `20261030153325_clerk_identity.sql`. Configure a chave pública do Clerk e teste login e acesso aos dados. O template Supabase antigo fica apenas como histórico.
6. `npm run dev`.

## Verificar
- `npm test`: regras de telefone, dinheiro, carência e retorno seguro.
- `npm run typecheck` e `npm run build`.
- `tests/database-rollback.sql`: testes de integração transacionais; todas as contas e registros de teste são revertidos ao final.

## Publicar
O projeto usa Next.js na Vercel. Consulte .env.example para os nomes das configurações públicas e privadas. O arquivo .env contém as configurações disponíveis desta publicação.
