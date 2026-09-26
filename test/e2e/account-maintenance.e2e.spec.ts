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
type AccountBody = { id: string; archivedAt: string | null };
type CategoryBody = { id: string };
type CategoryRuleBody = { id: string; status: string };
type AccountPageBody = { items: Array<{ id: string }> };
type ProblemBody = {
  errors?: Array<{ path: string; code: string; message: string }>;
};
type AuditUpdateRow = {
  action: string;
  resource_id: string;
  request_id: string;
  metadata: Record<string, unknown>;
};
type AuditTransitionRow = { metadata: { stateTransition: string } };

describe('account maintenance API', () => {
  let app: NestExpressApplication;
  let server: Server;
  let pool: Pool;
  let first: IdentityContextRow;
  let second: IdentityContextRow;
  const issuer = 'https://maintenance.auth0.example/';
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
    if (pool) await pool.end();
    if (app) await app.close();
  });

  it('rejects protected maintenance routes without a bearer token', async () => {
    await request(server)
      .patch(`/api/v1/accounts/${randomUUID()}`)
      .send({ name: 'Sem autenticação' })
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);

    await request(server)
      .post(`/api/v1/accounts/${randomUUID()}/deactivate`)
      .expect(401)
      .expect('Content-Type', /application\/problem\+json/);
  });

  it('returns Problem Details for malformed JSON before controller filters', async () => {
    const response = await request(server)
      .post('/api/v1/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);

    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Invalid request',
      status: 400,
      code: 'INVALID_REQUEST',
      detail: 'The request body contains invalid JSON.',
      errors: [
        {
          path: '$',
          code: 'INVALID_JSON',
          message: 'Invalid JSON body.',
        },
      ],
    });
  });

  it('updates a manual account and records only the changed fields', async () => {
    const created = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: 'Conta Original',
        type: 'checking',
        institutionName: 'Banco Original',
        initialBalance: '10.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);
    const accountId = (created.body as AccountBody).id;
    const requestId = randomUUID().toUpperCase();

    const updated = await request(server)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Authorization', 'Bearer valid-first')
      .set('X-Request-Id', requestId)
      .send({
        name: '  Conta   Atualizada ',
        initialBalance: '11.25',
        initialBalanceAsOf: '2026-09-02',
      })
      .expect(200);

    expect(updated.headers['x-request-id']).toBe(requestId.toLowerCase());
    expect(updated.body).toMatchObject({
      id: accountId,
      name: 'Conta Atualizada',
      institutionName: 'Banco Original',
      initialBalance: '11.25',
      initialBalanceAsOf: '2026-09-02',
      archivedAt: null,
    });

    const audit = await withTenant(pool, first.tenant_id, (client) =>
      client.query<AuditUpdateRow>(
        `SELECT action, resource_id, request_id, metadata
           FROM audit_records
          WHERE resource_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [accountId],
      ),
    );
    expect(audit.rows[0]).toMatchObject({
      action: 'account_updated',
      resource_id: accountId,
      request_id: requestId.toLowerCase(),
      metadata: {
        changedFields: ['name', 'initialBalance', 'initialBalanceAsOf'],
      },
    });
  });

  it('deactivates idempotently, hides the account, and blocks later updates', async () => {
    const created = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: `Conta Arquivável ${randomUUID()}`,
        type: 'cash',
        initialBalance: '0.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);
    const accountId = (created.body as AccountBody).id;
    const firstRequestId = randomUUID();

    const deactivated = await request(server)
      .post(`/api/v1/accounts/${accountId}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .set('X-Request-Id', firstRequestId)
      .expect(200);
    const deactivatedBody = deactivated.body as AccountBody;
    expect(deactivatedBody.archivedAt).toEqual(expect.any(String));
    expect(deactivated.headers['x-request-id']).toBe(firstRequestId);

    const archivedAt = deactivatedBody.archivedAt as string;
    const repeated = await request(server)
      .post(`/api/v1/accounts/${accountId}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    expect((repeated.body as AccountBody).archivedAt).toBe(archivedAt);
    expect(repeated.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    const update = await request(server)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Authorization', 'Bearer valid-first')
      .send({ name: 'Não pode alterar' })
      .expect(409);
    expect(update.body).toMatchObject({
      code: 'ACCOUNT_ARCHIVED',
      status: 409,
    });

    const listed = await request(server)
      .get('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    expect((listed.body as AccountPageBody).items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: accountId })]),
    );

    const audit = await withTenant(pool, first.tenant_id, (client) =>
      client.query<AuditTransitionRow>(
        `SELECT metadata
           FROM audit_records
          WHERE resource_id = $1 AND action = 'account_deactivated'
          ORDER BY created_at ASC, id ASC`,
        [accountId],
      ),
    );
    expect(audit.rows.map((row) => row.metadata)).toEqual([
      { stateTransition: 'active_to_archived' },
      { stateTransition: 'already_archived' },
    ]);
  });

  it('rejects account archival while an active rule references it', async () => {
    const created = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: `Conta com regra ${randomUUID()}`,
        type: 'cash',
        initialBalance: '0.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);
    const accountId = (created.body as AccountBody).id;
    const category = await request(server)
      .post('/api/v1/categories')
      .set('Authorization', 'Bearer valid-first')
      .send({ name: `Categoria de regra ${randomUUID()}` })
      .expect(201);
    const categoryId = (category.body as CategoryBody).id;
    const rule = await request(server)
      .post('/api/v1/category-rules')
      .set('Authorization', 'Bearer valid-first')
      .send({
        categoryId,
        conditionField: 'accountId',
        conditionOperator: 'equals',
        conditionValue: accountId,
        priority: 0,
      })
      .expect(201);
    expect((rule.body as CategoryRuleBody).status).toBe('active');

    const conflict = await request(server)
      .post(`/api/v1/accounts/${accountId}/deactivate`)
      .set('Authorization', 'Bearer valid-first')
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: 'CATEGORY_RULE_CONFLICT',
      status: 409,
    });

    const accountState = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ archived_at: Date | null }>(
        'SELECT archived_at FROM accounts WHERE id = $1',
        [accountId],
      ),
    );
    expect(accountState.rows[0]?.archived_at).toBeNull();
    const ruleState = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ status: string }>(
        'SELECT status FROM category_rules WHERE id = $1',
        [(rule.body as CategoryRuleBody).id],
      ),
    );
    expect(ruleState.rows[0]?.status).toBe('active');
  });

  it('does not reveal an account from another tenant', async () => {
    const created = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: `Conta Privada ${randomUUID()}`,
        type: 'other',
        initialBalance: '0.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);

    const response = await request(server)
      .patch(`/api/v1/accounts/${(created.body as AccountBody).id}`)
      .set('Authorization', 'Bearer valid-second')
      .send({ name: 'Tentativa cross-tenant' })
      .expect(404);
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Account not found',
      status: 404,
      code: 'ACCOUNT_NOT_FOUND',
      detail: 'The requested account was not found.',
    });

    const deactivation = await request(server)
      .post(`/api/v1/accounts/${(created.body as AccountBody).id}/deactivate`)
      .set('Authorization', 'Bearer valid-second')
      .expect(404);
    expect(deactivation.body).toEqual(response.body);
    expect(first.tenant_id).not.toBe(second.tenant_id);
  });

  it('rejects empty, immutable, and incomplete partial updates', async () => {
    const accountId = randomUUID();
    const empty = await request(server)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Authorization', 'Bearer valid-first')
      .send({})
      .expect(400);
    expect((empty.body as ProblemBody).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EMPTY_PATCH' }),
      ]),
    );

    const immutable = await request(server)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Authorization', 'Bearer valid-first')
      .send({ tenantId: first.tenant_id })
      .expect(400);
    expect((immutable.body as ProblemBody).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'tenantId', code: 'IMMUTABLE_FIELD' }),
      ]),
    );

    const incompleteBalance = await request(server)
      .patch(`/api/v1/accounts/${accountId}`)
      .set('Authorization', 'Bearer valid-first')
      .send({ initialBalance: '1.00' })
      .expect(400);
    expect((incompleteBalance.body as ProblemBody).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'BALANCE_REFERENCE_PAIR_REQUIRED',
        }),
      ]),
    );
  });

  it('requires confirmation when updating into a connected account identity', async () => {
    const connectedId = randomUUID();
    const duplicateName = `Conta Conectada ${randomUUID()}`;
    await withTenant(pool, first.tenant_id, (client) =>
      client.query(
        `INSERT INTO accounts (
           id, tenant_id, name, type, origin, institution_name,
           initial_balance, initial_balance_as_of, external_provider, external_account_id
         ) VALUES ($1, $2, $3, 'savings', 'connected', 'Banco Conectado',
                   '100.00', DATE '2026-09-01', 'pluggy', $4)`,
        [
          connectedId,
          first.tenant_id,
          duplicateName,
          `external-${randomUUID()}`,
        ],
      ),
    );
    const manual = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: `Conta Manual ${randomUUID()}`,
        type: 'cash',
        initialBalance: '0.00',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);

    const conflict = await request(server)
      .patch(`/api/v1/accounts/${(manual.body as AccountBody).id}`)
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: duplicateName,
        type: 'savings',
        institutionName: 'Banco Conectado',
      })
      .expect(409);
    expect(conflict.body).toMatchObject({
      code: 'POSSIBLE_CONNECTED_ACCOUNT_DUPLICATE',
      candidates: [expect.objectContaining({ id: connectedId })],
    });
  });

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
