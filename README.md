# Centralizador Financeiro — Backend

Backend NestJS do MVP acadêmico. Inclui execução local, Prisma/PostgreSQL, `/api/v1`, autenticação Auth0, provisionamento de identidade, contas e isolamento por tenant com RLS.

## Requisitos

- Node.js 22.12 ou superior dentro da faixa declarada em `package.json`.
- npm 10 ou superior.
- Docker com Compose.

## Execução local reproduzível

1. Copie `.env.example` para `.env`, substitua todos os valores `replace_me` por segredos exclusivamente locais e configure o issuer e a audiência da API no Auth0.
2. Instale dependências com `npm ci`.
3. Execute `docker compose up --build --wait`.
4. Consulte `http://localhost:3000/api/v1/health/live`, `/health/ready` ou `/docs` sob o mesmo prefixo.

Os endpoints de contas exigem um access token em `Authorization: Bearer <token>`. ID tokens não são aceitos.

O Compose cria um PostgreSQL local isolado, provisiona os papéis e aplica migrations antes de iniciar a API. Ele não acessa Neon.

## Banco e migrations

- `DATABASE_URL`: runtime com papel `cfi_runtime`; no Neon deve usar o endpoint pooled `-pooler`.
- `DIRECT_DATABASE_URL`: Prisma CLI com `cfi_migrator` e endpoint direto.
- `TEST_DATABASE_URL`: banco local/teste usando `cfi_test`.

Comandos:

```text
npm run prisma:validate
npm run prisma:generate
npm run db:migrate:dev
npm run db:migrate:deploy
npm run db:verify-migrations
npm run db:verify-rls
```

`db:verify-migrations` exige conexão direta como `cfi_migrator` e confirma que o histórico `_prisma_migrations` corresponde exatamente aos diretórios versionados, sem duplicatas, rollback ou migration incompleta. Ele também verifica ownership/RLS das tabelas protegidas e que `cfi_runtime`/`cfi_test` não possuem `SUPERUSER` nem `BYPASSRLS`.

Para evidência reproduzível, execute `db:migrate:deploy`, `db:verify-migrations` e `db:verify-rls` em um banco novo e isolado. O workflow não usa `prisma migrate resolve` para mascarar divergências de histórico.

Não execute migrations contra Neon, banco compartilhado ou ambiente remoto sem autorização específica. `prisma db push` não faz parte do workflow.

O script `scripts/database/bootstrap-roles.sql` é administrativo e recebe senhas por variáveis do `psql`; ele não integra as migrations Prisma. Em bancos remotos, sua execução exige um administrador autorizado e validação prévia da disponibilidade de `BYPASSRLS`.

## Qualidade

```text
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm test
```

Testes de integração exigem o PostgreSQL local já inicializado e migrado.

## Erros HTTP

Erros de validação, autenticação, autorização, conflito e recurso inexistente usam `application/problem+json` com o contrato Problem Details da API. JSON malformado é interceptado antes dos controllers e retorna `400 INVALID_REQUEST` com o detalhe `The request body contains invalid JSON.`; o corpo bruto nunca é registrado.

## Segurança

- Não registre tokens, connection strings, issuer/subject completos, nomes de contas ou valores financeiros.
- O runtime falha readiness se o papel for owner, superuser ou possuir `BYPASSRLS`.
- Toda operação protegida deve executar no wrapper transacional que define `app.current_tenant_id` localmente.
- RLS é defesa em profundidade; não substitui autenticação, autorização nem filtros de ownership.

Para remover o volume local e todos os dados fictícios, use `docker compose down --volumes`. Essa ação é destrutiva e nunca é executada automaticamente.
