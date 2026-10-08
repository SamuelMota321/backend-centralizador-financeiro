import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaIngestionRepository } from '../../src/modules/ingestion/adapters/outbound/prisma-ingestion.repository.js';
import { OFX_SOURCE_OBJECT_STORE } from '../../src/modules/ingestion/application/ports/ofx-source-object-store.port.js';
import { CreateOfxImportPreview } from '../../src/modules/ingestion/application/use-cases/create-ofx-import-preview.js';
import { ImportOfxTransaction } from '../../src/modules/transactions/application/use-cases/import-ofx-transaction.js';
import { InvalidTransactionRequest } from '../../src/modules/transactions/application/transactions.errors.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { createTestPool, withTenant } from '../helpers/database.js';

describe('OFX ingestion PostgreSQL persistence and RLS', () => {
  let module: TestingModule;
  let pool: Pool;
  let first: TenantContext;
  let second: TenantContext;
  let localAccountId: string;
  let secondLocalAccountId: string;
  let connectedAccountId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OFX_SOURCE_OBJECT_STORE)
      .useValue({ put: vi.fn(), delete: vi.fn() })
      .compile();
    await module.init();
    pool = createTestPool();
    const identities = module.get(PrismaIdentityContextResolver);
    first = await identities.resolveOrProvision(
      ExternalIdentity.auth0(
        'https://tests.auth0.example/',
        `auth0|${randomUUID()}`,
      ),
    );
    second = await identities.resolveOrProvision(
      ExternalIdentity.auth0(
        'https://tests.auth0.example/',
        `auth0|${randomUUID()}`,
      ),
    );
    localAccountId = await createAccount(pool, first.tenantId, 'manual');
    secondLocalAccountId = await createAccount(pool, first.tenantId, 'manual');
    connectedAccountId = await createAccount(pool, first.tenantId, 'connected');
  });

  afterAll(async () => {
    if (pool) {
      for (const context of [first, second]) {
        if (!context) continue;
        await withTenant(pool, context.tenantId, async (client) => {
          await client.query('DELETE FROM import_runs WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query('DELETE FROM idempotency_keys WHERE tenant_id = $1', [
            context.tenantId,
          ]);
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
    if (module) await module.close();
  });

  it('persists normalized rows atomically and hides them from another tenant', async () => {
    const content = readFileSync(
      new URL('../fixtures/ofx/ofx-1-bank-ascii.ofx', import.meta.url),
    );
    const preview = await module
      .get(CreateOfxImportPreview)
      .execute(first, content, localAccountId, `preview-${randomUUID()}`);
    const repository = module.get(PrismaIngestionRepository);

    expect(preview.run).toMatchObject({
      tenantId: first.tenantId,
      destinationAccountId: localAccountId,
      status: 'preview_ready',
      variant: 'ofx_1_sgml',
      totalItems: 1,
    });
    expect(preview.items).toMatchObject([{ isDuplicate: false }]);
    expect(await repository.findRun(first, preview.run.id)).toEqual(preview);
    expect(await repository.findRun(second, preview.run.id)).toBeNull();

    const own = await withTenant(pool, first.tenantId, async (client) =>
      Promise.all([
        client.query('SELECT id FROM import_runs WHERE id = $1', [preview.run.id]),
        client.query(
          'SELECT id FROM ingestion_items WHERE import_run_id = $1',
          [preview.run.id],
        ),
      ]),
    );
    const other = await withTenant(pool, second.tenantId, async (client) =>
      Promise.all([
        client.query('SELECT id FROM import_runs WHERE id = $1', [preview.run.id]),
        client.query(
          'SELECT id FROM ingestion_items WHERE import_run_id = $1',
          [preview.run.id],
        ),
      ]),
    );
    expect(own.map(({ rowCount }) => rowCount)).toEqual([1, 1]);
    expect(other.map(({ rowCount }) => rowCount)).toEqual([0, 0]);
  });

  it('deduplicates atomically per destination account and rejects connected accounts', async () => {
    const importer = module.get(ImportOfxTransaction);
    const input = {
      type: 'expense' as const,
      amount: '25.90',
      occurredOn: '2026-09-30',
      description: 'Mercado',
      externalId: 'synthetic-001',
    };
    const firstImport = await importer.execute(first, {
      ...input,
      accountId: localAccountId,
    });
    const repeatedImport = await importer.execute(first, {
      ...input,
      accountId: localAccountId,
    });
    const otherAccountImport = await importer.execute(first, {
      ...input,
      accountId: secondLocalAccountId,
    });

    expect(firstImport.disposition).toBe('imported');
    expect(repeatedImport.disposition).toBe('duplicate');
    expect(otherAccountImport.disposition).toBe('imported');
    await expect(
      importer.execute(first, { ...input, accountId: connectedAccountId }),
    ).rejects.toBeInstanceOf(InvalidTransactionRequest);

    const count = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM transactions
         WHERE account_id IN ($1, $2) AND external_identity_key IS NOT NULL`,
        [localAccountId, secondLocalAccountId],
      ),
    );
    expect(count.rows[0]?.count).toBe('2');

    const preview = await module
      .get(CreateOfxImportPreview)
      .execute(
        first,
        readFileSync(
          new URL('../fixtures/ofx/ofx-1-bank-ascii.ofx', import.meta.url),
        ),
        localAccountId,
        `duplicate-preview-${randomUUID()}`,
      );
    expect(preview.items).toMatchObject([{ isDuplicate: true }]);
  });
});

async function createAccount(
  pool: Pool,
  tenantId: string,
  origin: 'manual' | 'connected',
): Promise<string> {
  const connected = origin === 'connected';
  const result = await withTenant(pool, tenantId, (client: PoolClient) =>
    client.query<{ id: string }>(
      `INSERT INTO accounts (
         tenant_id, name, type, initial_balance, initial_balance_as_of,
         origin, external_provider, external_account_id
       ) VALUES ($1, $2, 'checking', '0.00', DATE '2026-09-20', $3, $4, $5)
       RETURNING id`,
      [
        tenantId,
        `Synthetic OFX ${randomUUID()}`,
        origin,
        connected ? 'pluggy' : null,
        connected ? randomUUID() : null,
      ],
    ),
  );
  const row = result.rows[0];
  if (!row) throw new Error('Expected a synthetic account.');
  return row.id;
}
