# Sprint 2 — Dev 1 backend verification and technical consolidation

Data da evidência: 2026-09-24

## Escopo

Esta evidência cobre a contribuição backend de S2-08 e a consolidação técnica backend de S2-09. Não inclui código web/mobile, testes de cliente, demonstração completa do Sprint nem a consolidação independente do Developer 3.

## Matriz de rastreabilidade

| Item  | Evidência backend                                                                                                  | Checks executáveis                                            | Classificação                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------- |
| S2-01 | Contratos de Transactions, controller, schemas e OpenAPI                                                           | `test/contract/openapi.contract.spec.ts`, `prisma:validate`   | Implementado e verificado                     |
| S2-02 | Domínio, Prisma repositories, migrations e tenant transaction                                                      | `test:unit`, `test:integration`, `db:verify-migrations`       | Implementado e verificado                     |
| S2-03 | Use cases de lançamentos e transferências, REST e idempotência                                                     | `test:unit`, `test:integration`, `test:e2e`                   | Implementado e verificado                     |
| S2-04 | Integração web/mobile                                                                                              | Responsabilidade do Developer 2                               | Fora da contribuição Dev 1; não validado aqui |
| S2-05 | Categorias, categorização, correção manual e histórico arquivado                                                   | `test:unit`, `test:integration`, `test:e2e`                   | Implementado e verificado                     |
| S2-06 | Lifecycle de regras, precedência, conflitos e conta referenciada                                                   | `test:unit`, `test:integration`, `test:e2e`, contrato OpenAPI | Implementado e verificado                     |
| S2-07 | Idempotência, auditoria, ownership e PostgreSQL RLS                                                                | `test:integration`, `test:e2e`, `db:verify-rls`               | Implementado e verificado                     |
| S2-08 | Cobertura de invariantes, use cases, persistência, REST, auth, cross-tenant, RLS, transferências, regras e OpenAPI | `npm test`, migration/RLS verification e contract test        | Implementado e verificado                     |
| S2-09 | Build, migrations locais, OpenAPI, instruções e handoffs                                                           | checks abaixo                                                 | Consolidação técnica backend concluída        |

## Correções de contrato incluídas

- Categoria duplicada usa a restrição única tenant+nome e retorna `409 CATEGORY_ALREADY_EXISTS`.
- `priority` aceita `0..2147483647`, inclusive, no domínio, entrada REST, OpenAPI e constraint PostgreSQL.
- Regras com `conditionField=accountId` aceitam somente conta ativa do mesmo tenant.
- Conta inexistente retorna `404 ACCOUNT_NOT_FOUND` tanto na criação quanto na edição da regra.
- `PATCH /category-rules/{ruleId}` vazio retorna `400 INVALID_REQUEST` com erro aninhado `EMPTY_PATCH`.
- `DELETE /category-rules/{ruleId}` é fixado em `200` com `CategoryRuleView`; `204` não é publicado.

O `EMPTY_PATCH` já existia no contrato de manutenção de contas. A implementação desta fase alinha o mesmo código para o PATCH de regras.

## Comandos e resultados

Executados no backend, com dados fictícios e banco PostgreSQL local:

| Comando                                       | Resultado                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run prisma:validate`                     | Passou; schema Prisma válido.                                                          |
| `npm run db:migrate:deploy`                   | Passou; aplicou `202609240001_s208_category_rule_contract`.                            |
| `npm run db:verify-migrations`                | Passou; 9 migrations, role transitions balanceadas, ownership e FORCE RLS confirmados. |
| `npm run db:verify-rls`                       | Passou; own rows visíveis, cross-tenant oculto e contexto ausente fail-closed.         |
| `npm run test:unit`                           | Passou: 24 arquivos, 111 testes.                                                       |
| `npm run test:integration`                    | Passou: 5 arquivos, 27 testes.                                                         |
| `npm run test:e2e`                            | Passou: 4 arquivos, 22 testes.                                                         |
| `npm test`                                    | Passou: 34 arquivos, 165 testes.                                                       |
| `npm run lint`                                | Passou.                                                                                |
| `npm run typecheck`                           | Passou.                                                                                |
| `npm run build`                               | Passou.                                                                                |
| `npx prettier --check` nos arquivos alterados | Passou.                                                                                |
| `git diff --check`                            | Passou; apenas avisos de normalização LF/CRLF do Git.                                  |
| `npm run openapi:generate`                    | Passou; segunda geração idempotente.                                                   |
| `test/contract/openapi.contract.spec.ts`      | Passou dentro da suíte focada: 4 testes.                                               |

O comando `npm run format:check` global foi executado, mas o repositório ainda possui 32 arquivos fora do escopo reportados pelo Prettier. Os arquivos alterados nesta contribuição passam no check direcionado; os arquivos não relacionados não foram reformatados para preservar mudanças fora do escopo.

O comando `git diff --exit-code -- openapi/openapi.json` retornou código 1 porque o artefato gerado contém as alterações de contrato desta contribuição ainda não commitadas. A geração repetida foi idempotente e o teste de contrato confirmou os limites e a resposta DELETE.

## Handoff para Developer 2

O contrato backend final para integração de clientes é:

- autenticação por access token Bearer; endpoints protegidos permanecem sob `/api/v1`;
- `priority` de regra é inteiro entre `0` e `2147483647`;
- regra por `accountId` exige conta ativa do mesmo tenant;
- conta inexistente: `404 ACCOUNT_NOT_FOUND`;
- conta arquivada: `409 ACCOUNT_ARCHIVED`;
- categoria duplicada: `409 CATEGORY_ALREADY_EXISTS`;
- PATCH vazio de regra: `400 INVALID_REQUEST`, com `errors[].code = EMPTY_PATCH`;
- DELETE de regra: `200` e corpo `CategoryRuleView`;
- cross-tenant continua sendo ocultado como recurso não encontrado;
- correção manual continua prevalecendo sobre categorização por regra;
- replay idempotente retorna a resposta original sem duplicar lançamentos ou auditoria.

Nenhum código web/mobile ou teste de cliente foi alterado. O Developer 2 deve regenerar ou atualizar os clientes tipados a partir de `openapi/openapi.json` após incorporar esta contribuição.

## Handoff para Developer 3

Evidências disponíveis:

- unitários para invariantes de regra, limite de prioridade, schemas, erros Problem Details e use cases;
- integração Prisma/PostgreSQL para tenant ownership, rollback, constraints, regra em conta arquivada e limite de prioridade;
- REST Supertest para autenticação, cross-tenant, transferências, idempotência, categorização, correção manual, lifecycle de regra, conflitos e códigos padronizados;
- `db:verify-migrations` e `db:verify-rls` em banco local isolado;
- contract test e geração idempotente do OpenAPI;
- auditoria verificada nos fluxos existentes de lançamentos, transferências, categorização e regras.

Limitações e pontos para a consolidação independente:

- não foi executada demonstração completa web/mobile;
- não foram executados testes de cliente;
- `npm run format:check` global continua bloqueado por arquivos fora desta contribuição;
- `git diff --exit-code -- openapi/openapi.json` somente ficará verde depois que a alteração gerada for incorporada ao commit;
- a validação de migration/RLS foi feita em PostgreSQL local, não em Neon ou ambiente compartilhado.

Durante a validação houve duas falhas intermediárias corrigidas: o contrato OpenAPI inicialmente estava desatualizado após a mudança de schema, e o mapeamento de `P2002` precisou aceitar a forma estrutural emitida pelo Prisma. A execução final das suítes ficou verde.
