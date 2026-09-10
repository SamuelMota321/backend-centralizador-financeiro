import type { INestApplication } from '@nestjs/common';
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
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };

describe('accounts API', () => {
  let app: INestApplication;
  let server: Server;
  let pool: Pool;
  const issuer = 'https://tenant.example.com/';
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
      if (!token || ['invalid', 'expired', 'id-token'].includes(token)) {
        return Promise.reject(new AccessTokenVerificationError());
      }
      if (token === 'no-context') {
        return Promise.reject(new IdentityContextUnavailable());
      }
      if (token === 'technical-error') {
        return Promise.reject(new Error('sensitive technical failure'));
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
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
    pool = createTestPool();
  });

  afterAll(async () => {
    for (const subject of Object.values(subjects)) {
      const result = await pool.query<IdentityContextRow>(
        "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
        [issuer, subject],
      );
      const context = result.rows[0];
      if (!context) continue;
      await withTenant(pool, context.tenant_id, async (client) => {
        await client.query('DELETE FROM accounts WHERE tenant_id = $1', [
          context.tenant_id,
        ]);
        await client.query('DELETE FROM identity_links WHERE user_id = $1', [
          context.user_id,
        ]);
        await client.query('DELETE FROM users WHERE id = $1', [
          context.user_id,
        ]);
        await client.query('DELETE FROM tenants WHERE id = $1', [
          context.tenant_id,
        ]);
      });
    }
    if (pool) await pool.end();
    if (app) await app.close();
  });

  it('keeps health public and rejects missing or invalid access tokens', async () => {
    await request(server).get('/api/v1/health/live').expect(200);

    const missing = await request(server).get('/api/v1/accounts').expect(401);
    expect(missing.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(missing.body).toMatchObject({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });
    expect(missing.headers['www-authenticate']).toBe('Bearer');

    for (const token of ['invalid', 'expired', 'id-token']) {
      const response = await request(server)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(response.body as unknown).toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    }
  });

  it('returns generic 403 and 500 problems without leaking technical detail', async () => {
    const forbidden = await request(server)
      .get('/api/v1/accounts')
      .set('Authorization', 'Bearer no-context')
      .expect(403);
    expect(forbidden.body as unknown).toMatchObject({
      code: 'IDENTITY_CONTEXT_UNAVAILABLE',
    });

    const failure = await request(server)
      .get('/api/v1/accounts')
      .set('Authorization', 'Bearer technical-error')
      .expect(500);
    expect(failure.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(failure.body)).not.toContain(
      'sensitive technical failure',
    );
  });

  it('validates input and creates a manual account for the provisioned tenant', async () => {
    const invalid = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({ tenantId: 'client-controlled' })
      .expect(400);
    const invalidBody = invalid.body as unknown as {
      code: string;
      errors: unknown;
    };
    expect(invalidBody.code).toBe('INVALID_REQUEST');
    expect(invalidBody.errors).toBeInstanceOf(Array);

    const created = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({
        name: 'Conta Manual',
        type: 'checking',
        institutionName: 'Banco Teste',
        initialBalance: '10.50',
        initialBalanceAsOf: '2026-09-01',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'Conta Manual',
      type: 'checking',
      origin: 'manual',
      institutionName: 'Banco Teste',
      initialBalance: '10.50',
      initialBalanceAsOf: '2026-09-01',
      currencyCode: 'BRL',
      archivedAt: null,
    });
    expect(created.body).not.toHaveProperty('tenantId');
    expect(created.body).not.toHaveProperty('externalAccountId');
  });

  it('lists only active accounts from the authenticated tenant', async () => {
    const first = await request(server)
      .get('/api/v1/accounts?page=1&pageSize=20')
      .set('Authorization', 'Bearer valid-first')
      .expect(200);
    const firstBody = first.body as unknown as {
      total: number;
      items: unknown[];
    };
    expect(firstBody).toMatchObject({ page: 1, pageSize: 20 });
    expect(firstBody.total).toBeGreaterThanOrEqual(1);
    expect(firstBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Conta Manual' }),
      ]),
    );

    const second = await request(server)
      .get('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-second')
      .expect(200);
    expect(second.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('requires explicit confirmation for a possible connected duplicate', async () => {
    const contextResult = await pool.query<IdentityContextRow>(
      "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
      [issuer, subjects.first],
    );
    const context = contextResult.rows[0];
    if (!context) throw new Error('Expected first identity context.');

    await withTenant(pool, context.tenant_id, (client) =>
      client.query(
        `INSERT INTO accounts (
           tenant_id, name, type, origin, institution_name,
           initial_balance, initial_balance_as_of, external_provider, external_account_id
         ) VALUES ($1, 'Conta Conectada', 'savings', 'connected', 'Banco Teste',
                   '100.00', DATE '2026-09-01', 'pluggy', $2)`,
        [context.tenant_id, `external-${randomUUID()}`],
      ),
    );

    const payload = {
      name: '  Conta   Conectada ',
      type: 'savings',
      institutionName: ' Banco Teste ',
      initialBalance: '0.00',
      initialBalanceAsOf: '2026-09-01',
    };
    const conflict = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send(payload)
      .expect(409);
    expect(conflict.body as unknown).toMatchObject({
      code: 'POSSIBLE_CONNECTED_ACCOUNT_DUPLICATE',
      candidates: [
        expect.objectContaining({
          name: 'Conta Conectada',
          type: 'savings',
          origin: 'connected',
          institutionName: 'Banco Teste',
        }),
      ],
    });

    const confirmed = await request(server)
      .post('/api/v1/accounts')
      .set('Authorization', 'Bearer valid-first')
      .send({ ...payload, confirmPossibleDuplicate: true })
      .expect(201);
    expect(confirmed.body).toMatchObject({
      name: 'Conta Conectada',
      origin: 'manual',
    });
  });
});
