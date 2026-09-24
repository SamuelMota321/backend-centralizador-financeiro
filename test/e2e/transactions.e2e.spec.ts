import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from '../../src/modules/identity/adapters/inbound/auth0-access-token-verifier.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import { IdentityContextUnavailable } from '../../src/modules/identity/domain/identity.errors.js';
import { jsonParserProblemDetailsMiddleware } from '../../src/shared/adapters/inbound/json-parser-problem-details.middleware.js';
import { RequestIdMiddleware } from '../../src/shared/adapters/inbound/request-id.middleware.js';
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };
type AccountBody = { id: string };
type TransactionBody = {
  id: string;
  accountId: string;
  type: string;
  amount: string;
  transferId: string | null;
  transferSide: string | null;
};
type TransferBody = { entries: TransactionBody[] };
type CategoryBody = { id: string };
type RuleBody = { id: string };

describe('transactions API', () => {
  let app: NestExpressApplication;
  let server: Server;
  let pool: Pool;
  let first: IdentityContextRow;
  let second: IdentityContextRow;
  const issuer = 'https://transactions.auth0.example/';
  const subjects = {
    first: `auth0|${randomUUID()}`,
    second: `auth0|${randomUUID()}`,
  };

  const verifier: AccessTokenVerifier = {
    verify: (incomingRequest) => {
      const token = incomingRequest.headers.authorization?.replace(
        /^Bearer\s+/i,
        '',
      );
      if (!token) return Promise.reject(new AccessTokenVerificationError());
      if (token === 'no-context') {
        return Promise.reject(new IdentityContextUnavailable());
      }
      const subject =
        token === 'valid-second' ? subjects.second : subjects.first;
      return Promise.resolve(ExternalIdentity.auth0(issuer, subject));
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useBodyParser('json');
    app.use(new RequestIdMiddleware().use);
    app.use(jsonParserProblemDetailsMiddleware);
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    pool = createTestPool();
    first = await resolveContext(subjects.first);
    second = await resolveContext(subjects.second);
  });

  afterAll(async () => {
    if (pool) {
      for (const context of [first, second]) {
        if (!context) continue;
        await withTenant(pool, context.tenant_id, async (client) => {
          await client.query(
            'DELETE FROM idempotency_keys WHERE tenant_id = $1',
            [context.tenant_id],
          );
          await client.query(
            'DELETE FROM category_rules WHERE tenant_id = $1',
            [context.tenant_id],
          );
          await client.query('DELETE FROM transactions WHERE tenant_id = $1', [
            context.tenant_id,
          ]);
          await client.query('DELETE FROM categories WHERE tenant_id = $1', [
            context.tenant_id,
          ]);
          await client.query('DELETE FROM accounts WHERE tenant_id = $1', [
            context.tenant_id,
          ]);
          await client.query('DELETE FROM identity_links WHERE user_id = $1', [
            context.user_id,
          ]);
        });
      }
      await pool.end();
    }
    if (app) await app.close();
  });

  it('requires authentication and the idempotency header', async () => {
    await request(server).post('/api/v1/transactions').send({}).expect(401);

    const account = await createAccount('valid-first', 'Conta idempotência');
    const response = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .send({
        accountId: account.id,
        type: 'income',
        amount: '1.00',
        occurredOn: '2026-09-20',
      })
      .expect(400);
    expect(response.body).toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });
  });

  it('registers income and expense and replays an idempotent request', async () => {
    const account = await createAccount('valid-first', 'Conta movimentos');
    const incomePayload = {
      accountId: account.id,
      type: 'income',
      amount: '150.00',
      occurredOn: '2026-09-20',
      description: 'Salário',
    };
    const created = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'income-e2e-key')
      .send(incomePayload)
      .expect(201);
    expect(created.body).toMatchObject({
      accountId: account.id,
      type: 'income',
      amount: '150.00',
      status: 'posted',
      transferId: null,
      categorizationStatus: 'unclassified',
    });

    const repeated = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'income-e2e-key')
      .send(incomePayload)
      .expect(201);
    expect(repeated.body).toEqual(created.body);

    const createdId = (created.body as { id: string }).id;
    const requestId = created.headers['x-request-id'];
    const audit = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{
        tenant_id: string;
        actor_user_id: string;
        action: string;
        resource_type: string;
        resource_id: string;
        outcome: string;
        request_id: string;
        created_at: Date;
        metadata: { changedFields: string[] };
      }>(
        `SELECT tenant_id, actor_user_id, action::text, resource_type::text,
                resource_id, outcome::text, request_id, created_at, metadata
         FROM audit_records WHERE request_id = $1`,
        [requestId],
      ),
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]).toMatchObject({
      tenant_id: first.tenant_id,
      actor_user_id: first.user_id,
      action: 'transaction_created',
      resource_type: 'transaction',
      resource_id: createdId,
      outcome: 'success',
      request_id: requestId,
      metadata: { changedFields: [] },
    });
    expect(audit.rows[0]?.created_at).toBeInstanceOf(Date);
    expect(Object.keys(audit.rows[0]?.metadata ?? {})).toEqual([
      'changedFields',
    ]);

    const foreignList = await request(server)
      .get('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-second')
      .expect(200);
    const foreignListBody = foreignList.body as { items: { id: string }[] };
    expect(foreignListBody.items).not.toContainEqual(
      expect.objectContaining({ id: createdId }),
    );
    const foreignMutation = await request(server)
      .patch(`/api/v1/transactions/${createdId}/category`)
      .set('Authorization', 'Bearer valid-second')
      .send({ categorizationStatus: 'uncertain' })
      .expect(404);
    expect(foreignMutation.body).toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
      status: 404,
    });

    const conflict = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'income-e2e-key')
      .send({ ...incomePayload, amount: '151.00' })
      .expect(409);
    expect(conflict.body).toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });

    const expense = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'expense-e2e-key')
      .send({
        ...incomePayload,
        type: 'expense',
        amount: '12.30',
        description: null,
      })
      .expect(201);
    expect(expense.body).toMatchObject({
      type: 'expense',
      amount: '12.30',
      description: null,
    });

    const rows = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM transactions WHERE account_id = $1',
        [account.id],
      ),
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('creates only one movement for concurrent requests with the same idempotency key', async () => {
    const account = await createAccount('valid-first', 'Conta concorrência');
    const key = `concurrent-${randomUUID()}`;
    const payload = {
      accountId: account.id,
      type: 'expense',
      amount: '7.50',
      occurredOn: '2026-09-20',
      description: 'Comando concorrente',
    };
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(server)
          .post('/api/v1/transactions')
          .set('Authorization', 'Bearer valid-first')
          .set('Idempotency-Key', key)
          .send(payload)
          .expect(201),
      ),
    );
    expect(results[0]?.body).toEqual(results[1]?.body);

    const persisted = await withTenant(pool, first.tenant_id, async (client) =>
      Promise.all([
        client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM transactions WHERE account_id = $1',
          [account.id],
        ),
        client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM audit_records
           WHERE resource_id = $1 AND action = 'transaction_created'`,
          [(results[0]?.body as { id: string }).id],
        ),
      ]),
    );
    expect(persisted.map((result) => result.rows[0]?.count)).toEqual([
      '1',
      '1',
    ]);
  });

  it('creates two atomic accounting entries and never exposes a fund movement', async () => {
    const from = await createAccount('valid-first', 'Conta origem');
    const to = await createAccount('valid-first', 'Conta destino');
    const payload = {
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: '25.40',
      occurredOn: '2026-09-20',
      description: 'Reserva',
    };
    const created = await request(server)
      .post('/api/v1/transfers')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'transfer-e2e-key')
      .send(payload)
      .expect(201);
    const body = created.body as TransferBody;
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      accountId: from.id,
      type: 'transfer',
      transferSide: 'outgoing',
      amount: '25.40',
    });
    expect(body.entries[1]).toMatchObject({
      accountId: to.id,
      type: 'transfer',
      transferSide: 'incoming',
      transferId: body.entries[0]?.transferId,
    });
    expect(body).not.toHaveProperty('payment');
    expect(body).not.toHaveProperty('pix');

    const repeated = await request(server)
      .post('/api/v1/transfers')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'transfer-e2e-key')
      .send(payload)
      .expect(201);
    expect(repeated.body).toEqual(body);

    const transferAudit = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_records
         WHERE request_id = $1 AND action = 'transfer_created'`,
        [created.headers['x-request-id']],
      ),
    );
    expect(transferAudit.rows[0]?.count).toBe('1');

    const rows = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM transactions WHERE transfer_id = $1',
        [body.entries[0]?.transferId],
      ),
    );
    expect(rows.rows[0]?.count).toBe('2');
    const balances = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ initial_balance: string }>(
        'SELECT initial_balance::text FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[from.id, to.id]],
      ),
    );
    expect(balances.rows.map(({ initial_balance }) => initial_balance)).toEqual(
      ['0.00', '0.00'],
    );
  });

  it('treats another tenant account as not found and blocks archived accounts', async () => {
    const privateAccount = await createAccount('valid-first', 'Conta privada');
    const crossTenant = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-second')
      .set('Idempotency-Key', 'cross-tenant-key')
      .send({
        accountId: privateAccount.id,
        type: 'income',
        amount: '1.00',
        occurredOn: '2026-09-20',
      })
      .expect(404);
    expect(crossTenant.body).toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
      status: 404,
    });

    const archived = await createAccount('valid-first', 'Conta arquivada');
    await request(server)
      .post(`/api/v1/accounts/${archived.id}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    const archivedResponse = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', 'archived-key')
      .send({
        accountId: archived.id,
        type: 'expense',
        amount: '1.00',
        occurredOn: '2026-09-20',
      })
      .expect(409);
    expect(archivedResponse.body).toMatchObject({
      code: 'ACCOUNT_ARCHIVED',
      status: 409,
    });
  });

  it('categorizes transactions with personal rules and preserves explicit corrections', async () => {
    const account = await createAccount('valid-first', 'Conta categorização');
    const category = await request(server)
      .post('/api/v1/categories')
      .set('Authorization', 'Bearer valid-first')
      .send({ name: `Mercado ${randomUUID()}` })
      .expect(201);
    const secondCategory = await request(server)
      .post('/api/v1/categories')
      .set('Authorization', 'Bearer valid-first')
      .send({ name: `Lazer ${randomUUID()}` })
      .expect(201);
    const categoryBody = category.body as CategoryBody;
    const secondCategoryBody = secondCategory.body as CategoryBody;
    const rule = await request(server)
      .post('/api/v1/category-rules')
      .set('Authorization', 'Bearer valid-first')
      .send({
        categoryId: categoryBody.id,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'mercado',
        priority: 10,
      })
      .expect(201);
    const ruleBody = rule.body as RuleBody;

    const created = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `categorization-${randomUUID()}`)
      .send({
        accountId: account.id,
        type: 'expense',
        amount: '22.00',
        occurredOn: '2026-09-20',
        description: 'Compra no Mercado',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      categoryId: categoryBody.id,
      categorizationStatus: 'categorized',
      categorizationSource: 'rule',
    });

    const corrected = await request(server)
      .patch(
        `/api/v1/transactions/${(created.body as { id: string }).id}/category`,
      )
      .set('Authorization', 'Bearer valid-first')
      .send({ categoryId: secondCategoryBody.id })
      .expect(200);
    expect(corrected.body).toMatchObject({
      categoryId: secondCategoryBody.id,
      categorizationStatus: 'categorized',
      categorizationSource: 'manual',
    });

    const uncertain = await request(server)
      .patch(
        `/api/v1/transactions/${(created.body as { id: string }).id}/category`,
      )
      .set('Authorization', 'Bearer valid-first')
      .send({ categorizationStatus: 'uncertain' })
      .expect(200);
    expect(uncertain.body).toMatchObject({
      categoryId: null,
      categorizationStatus: 'uncertain',
      categorizationSource: null,
    });

    await request(server)
      .post(`/api/v1/category-rules/${ruleBody.id}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    await request(server)
      .post(`/api/v1/category-rules/${ruleBody.id}/activate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    await request(server)
      .delete(`/api/v1/category-rules/${ruleBody.id}`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    const reactivation = await request(server)
      .post(`/api/v1/category-rules/${ruleBody.id}/activate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(409);
    expect(reactivation.body).toMatchObject({
      code: 'CATEGORY_RULE_CONFLICT',
      status: 409,
    });

    const foreignRuleUpdate = await request(server)
      .patch(`/api/v1/category-rules/${ruleBody.id}`)
      .set('Authorization', 'Bearer valid-second')
      .send({ priority: 99 })
      .expect(404);
    expect(foreignRuleUpdate.body).toMatchObject({
      code: 'CATEGORY_RULE_NOT_FOUND',
      status: 404,
    });
  });

  it('keeps archived categories in history without allowing new assignment', async () => {
    const account = await createAccount(
      'valid-first',
      'Conta categoria arquivada',
    );
    const categoryResponse = await request(server)
      .post('/api/v1/categories')
      .set('Authorization', 'Bearer valid-first')
      .send({ name: `Histórico ${randomUUID()}` })
      .expect(201);
    const categoryId = (categoryResponse.body as CategoryBody).id;
    const ruleResponse = await request(server)
      .post('/api/v1/category-rules')
      .set('Authorization', 'Bearer valid-first')
      .send({
        categoryId,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'histórico preservado',
        priority: 10,
      })
      .expect(201);
    const ruleId = (ruleResponse.body as RuleBody).id;

    const historical = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `archived-history-${randomUUID()}`)
      .send({
        accountId: account.id,
        type: 'expense',
        amount: '12.00',
        occurredOn: '2026-09-20',
        description: 'Compra com histórico preservado',
      })
      .expect(201);
    const historicalId = (historical.body as TransactionBody).id;
    expect(historical.body).toMatchObject({
      categoryId,
      categorizationStatus: 'categorized',
      categorizationSource: 'rule',
    });

    await request(server)
      .post(`/api/v1/categories/${categoryId}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);

    const history = await request(server)
      .get('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    const historyBody = history.body as {
      items: { id: string; categoryId: string | null }[];
    };
    expect(historyBody.items).toContainEqual(
      expect.objectContaining({ id: historicalId, categoryId }),
    );

    const laterMatchingTransaction = await request(server)
      .post('/api/v1/transactions')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `archived-rule-${randomUUID()}`)
      .send({
        accountId: account.id,
        type: 'expense',
        amount: '13.00',
        occurredOn: '2026-09-20',
        description: 'Outra compra com histórico preservado',
      })
      .expect(201);
    expect(laterMatchingTransaction.body).toMatchObject({
      categoryId: null,
      categorizationStatus: 'unclassified',
      categorizationSource: null,
    });

    const conditionUpdate = await request(server)
      .patch(`/api/v1/category-rules/${ruleId}`)
      .set('Authorization', 'Bearer valid-first')
      .send({ categoryId, conditionValue: 'histórico ajustado' })
      .expect(200);
    expect(conditionUpdate.body).toMatchObject({ categoryId });

    const reassignment = await request(server)
      .patch(`/api/v1/transactions/${historicalId}/category`)
      .set('Authorization', 'Bearer valid-first')
      .send({ categoryId })
      .expect(409);
    expect(reassignment.body).toMatchObject({
      code: 'CATEGORY_ARCHIVED',
      status: 409,
    });

    const newRule = await request(server)
      .post('/api/v1/category-rules')
      .set('Authorization', 'Bearer valid-first')
      .send({
        categoryId,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'new archived assignment',
        priority: 1,
      })
      .expect(409);
    expect(newRule.body).toMatchObject({
      code: 'CATEGORY_ARCHIVED',
      status: 409,
    });
  });

  async function createAccount(
    token: string,
    name: string,
  ): Promise<AccountBody> {
    const response = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `${name} ${randomUUID()}`,
        type: 'checking',
        initialBalance: '0.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);
    return response.body as AccountBody;
  }

  async function resolveContext(subject: string): Promise<IdentityContextRow> {
    const result = await pool.query<IdentityContextRow>(
      "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
      [issuer, subject],
    );
    const context = result.rows[0];
    if (!context) throw new Error('Expected identity context.');
    return context;
  }
});
