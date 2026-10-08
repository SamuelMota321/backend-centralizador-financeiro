import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from '../../src/modules/identity/adapters/inbound/auth0-access-token-verifier.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import { OFX_SOURCE_OBJECT_STORE } from '../../src/modules/ingestion/application/ports/ofx-source-object-store.port.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { jsonParserProblemDetailsMiddleware } from '../../src/shared/adapters/inbound/json-parser-problem-details.middleware.js';
import { RequestIdMiddleware } from '../../src/shared/adapters/inbound/request-id.middleware.js';
import { createTestPool, withTenant } from '../helpers/database.js';

type ImportRunBody = Readonly<{
  id: string;
  destinationAccountId: string;
  status: string;
  totalItems: number;
  importedItems: number;
  ignoredItems: number;
  failedItems: number;
  items: readonly Readonly<{
    isDuplicate: boolean;
    status: string;
  }>[];
}>;

describe('authenticated OFX ingestion API', () => {
  let app: NestExpressApplication;
  let server: Server;
  let pool: Pool;
  let first: TenantContext;
  let second: TenantContext;
  let firstAccountId: string;
  let secondAccountId: string;
  const issuer = 'https://ingestion.auth0.example/';
  const subjects = { first: `auth0|${randomUUID()}`, second: `auth0|${randomUUID()}` };
  const sourceObjectStore = {
    put: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  };
  const verifier: AccessTokenVerifier = {
    verify: (incomingRequest) => {
      const token = incomingRequest.headers.authorization?.replace(
        /^Bearer\s+/iu,
        '',
      );
      if (!token) return Promise.reject(new AccessTokenVerificationError());
      if (token === 'valid-second') {
        return Promise.resolve(ExternalIdentity.auth0(issuer, subjects.second));
      }
      return Promise.resolve(ExternalIdentity.auth0(issuer, subjects.first));
    },
  };
  const ofxFixture = readFileSync(
    new URL('../fixtures/ofx/ofx-1-bank-ascii.ofx', import.meta.url),
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(OFX_SOURCE_OBJECT_STORE)
      .useValue(sourceObjectStore)
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
    const identities = module.get(PrismaIdentityContextResolver);
    first = await identities.resolveOrProvision(
      ExternalIdentity.auth0(issuer, subjects.first),
    );
    second = await identities.resolveOrProvision(
      ExternalIdentity.auth0(issuer, subjects.second),
    );
    firstAccountId = await createAccount(pool, first, 'Primary OFX account');
    secondAccountId = await createAccount(pool, first, 'Secondary OFX account');
  });

  afterAll(async () => {
    if (pool) {
      for (const context of [first, second]) {
        if (!context) continue;
        await withTenant(pool, context.tenantId, async (client) => {
          await client.query('DELETE FROM import_runs WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query(
            'DELETE FROM idempotency_keys WHERE tenant_id = $1',
            [context.tenantId],
          );
          await client.query('DELETE FROM transactions WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query('DELETE FROM audit_records WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query('DELETE FROM accounts WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query('DELETE FROM identity_links WHERE user_id = $1', [
            context.userId,
          ]);
          await client.query('DELETE FROM users WHERE id = $1', [
            context.userId,
          ]);
          await client.query('DELETE FROM tenants WHERE id = $1', [
            context.tenantId,
          ]);
        });
      }
      await pool.end();
    }
    if (app) await app.close();
  });

  it('authenticates uploads and rejects PDF and oversized files before R2 or persistence', async () => {
    await request(server).post('/api/v1/ingestions/ofx/previews').expect(401);

    const pdf = readFileSync(
      new URL('../fixtures/ofx/unsupported-pdf.pdf', import.meta.url),
    );
    await request(server)
      .post('/api/v1/ingestions/ofx/previews')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `pdf-${randomUUID()}`)
      .field('destinationAccountId', firstAccountId)
      .attach('file', pdf, { filename: 'statement.pdf', contentType: 'application/pdf' })
      .expect(415);

    const malformed = readFileSync(
      new URL('../fixtures/ofx/malformed.ofx', import.meta.url),
    );
    await request(server)
      .post('/api/v1/ingestions/ofx/previews')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `malformed-${randomUUID()}`)
      .field('destinationAccountId', firstAccountId)
      .attach('file', malformed, {
        filename: 'malformed.ofx',
        contentType: 'application/octet-stream',
      })
      .expect(422);

    await request(server)
      .post('/api/v1/ingestions/ofx/previews')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `large-${randomUUID()}`)
      .field('destinationAccountId', firstAccountId)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 0x20), {
        filename: 'large.ofx',
        contentType: 'application/octet-stream',
      })
      .expect(413);

    expect(sourceObjectStore.put).not.toHaveBeenCalled();
    const runCount = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM import_runs WHERE tenant_id = $1',
        [first.tenantId],
      ),
    );
    expect(runCount.rows[0]?.count).toBe('0');
  });

  it('previews before confirmation, shows duplicates, isolates tenants, and confirms idempotently', async () => {
    const previewKey = `preview-${randomUUID()}`;
    const createPreview = () =>
      request(server)
        .post('/api/v1/ingestions/ofx/previews')
        .set('Authorization', 'Bearer valid-first')
        .set('Idempotency-Key', previewKey)
        .field('destinationAccountId', firstAccountId)
        .attach('file', ofxFixture, {
          filename: 'statement.ofx',
          contentType: 'application/octet-stream',
        });

    const previewResponse = await createPreview().expect(201);
    const preview = previewResponse.body as ImportRunBody;
    expect(preview).toMatchObject({ status: 'preview_ready', totalItems: 1 });
    expect(preview.items).toMatchObject([{ status: 'previewed', isDuplicate: false }]);
    const replay = (await createPreview().expect(201)).body as ImportRunBody;
    expect(replay.id).toBe(preview.id);

    await request(server)
      .get(`/api/v1/ingestions/${preview.id}`)
      .set('Authorization', 'Bearer valid-second')
      .expect(404);

    const confirmationKey = `confirm-${randomUUID()}`;
    const confirm = () =>
      request(server)
        .post(`/api/v1/ingestions/${preview.id}/confirmations`)
        .set('Authorization', 'Bearer valid-first')
        .set('Idempotency-Key', confirmationKey)
        .send({ destinationAccountId: firstAccountId });
    const completed = (await confirm().expect(200)).body as ImportRunBody;
    expect(completed).toMatchObject({
      status: 'completed',
      importedItems: 1,
      ignoredItems: 0,
      failedItems: 0,
    });
    expect((await confirm().expect(200)).body).toMatchObject({ id: preview.id, importedItems: 1 });

    const transactionCount = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM transactions WHERE tenant_id = $1 AND account_id = $2',
        [first.tenantId, firstAccountId],
      ),
    );
    expect(transactionCount.rows[0]?.count).toBe('1');

    const duplicatePreviewResponse = await request(server)
      .post('/api/v1/ingestions/ofx/previews')
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `duplicate-${randomUUID()}`)
      .field('destinationAccountId', firstAccountId)
      .attach('file', ofxFixture, {
        filename: 'statement.ofx',
        contentType: 'application/octet-stream',
      })
      .expect(201);
    const duplicatePreview = duplicatePreviewResponse.body as ImportRunBody;
    expect(duplicatePreview.items).toMatchObject([
      { status: 'previewed', isDuplicate: true },
    ]);
    const duplicateResult = (await request(server)
      .post(`/api/v1/ingestions/${duplicatePreview.id}/confirmations`)
      .set('Authorization', 'Bearer valid-first')
      .set('Idempotency-Key', `confirm-duplicate-${randomUUID()}`)
      .send({ destinationAccountId: firstAccountId })
      .expect(200)).body as ImportRunBody;
    expect(duplicateResult).toMatchObject({
      status: 'completed',
      importedItems: 0,
      ignoredItems: 1,
      failedItems: 0,
    });
  });

  it('rejects reuse of a preview idempotency key with another normalized payload', async () => {
    const idempotencyKey = `preview-reuse-${randomUUID()}`;
    const upload = (accountId: string) =>
      request(server)
        .post('/api/v1/ingestions/ofx/previews')
        .set('Authorization', 'Bearer valid-first')
        .set('Idempotency-Key', idempotencyKey)
        .field('destinationAccountId', accountId)
        .attach('file', ofxFixture, {
          filename: 'statement.ofx',
          contentType: 'application/octet-stream',
        });

    await upload(firstAccountId).expect(201);
    await upload(secondAccountId).expect(409);
  });
});

async function createAccount(
  pool: Pool,
  context: TenantContext,
  name: string,
): Promise<string> {
  const result = await withTenant(pool, context.tenantId, (client: PoolClient) =>
    client.query<{ id: string }>(
      `INSERT INTO accounts (
         tenant_id, name, type, initial_balance, initial_balance_as_of,
         origin, external_provider, external_account_id
       ) VALUES ($1, $2, 'checking', '0.00', CURRENT_DATE, 'manual', NULL, NULL)
       RETURNING id`,
      [context.tenantId, name],
    ),
  );
  const row = result.rows[0];
  if (!row) throw new Error('Expected a test account.');
  return row.id;
}
