import { createHash, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaPluggyInitialImportRepository } from '../../src/modules/ingestion/adapters/outbound/prisma-pluggy-initial-import.repository.js';
import { PluggyInitialImportIdempotencyConflict } from '../../src/modules/ingestion/domain/pluggy-initial-import.errors.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { createTestPool, withTenant } from '../helpers/database.js';

const itemHash = (itemId: string) =>
  createHash('sha256').update(itemId.toLowerCase(), 'utf8').digest('hex');

describe('Pluggy completion idempotency reservation', () => {
  let module: TestingModule;
  let pool: Pool;
  let repository: PrismaPluggyInitialImportRepository;
  let context: TenantContext;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    pool = createTestPool();
    repository = module.get(PrismaPluggyInitialImportRepository);
    const identities = module.get(PrismaIdentityContextResolver);
    context = await identities.resolveOrProvision(
      ExternalIdentity.auth0(
        'https://tests.auth0.example/',
        `auth0|${randomUUID()}`,
      ),
    );
  });

  afterAll(async () => {
    if (pool && context) {
      await withTenant(pool, context.tenantId, async (client) => {
        await client.query(
          'DELETE FROM idempotency_keys WHERE tenant_id = $1',
          [context.tenantId],
        );
        await client.query('DELETE FROM identity_links WHERE user_id = $1', [
          context.userId,
        ]);
        await client.query('DELETE FROM users WHERE id = $1', [context.userId]);
        await client.query('DELETE FROM tenants WHERE id = $1', [
          context.tenantId,
        ]);
      });
    }
    if (pool) await pool.end();
    if (module) await module.close();
  });

  it('replays the same key and item after the reservation is completed', async () => {
    const key = randomUUID();
    const runId = randomUUID();
    const hash = itemHash(randomUUID());
    const now = new Date();
    const first = await repository.reserveStart(context, key, hash, now);
    expect(typeof first.claimId).toBe('string');
    expect(first.replayRunId).toBeNull();
    await withTenant(pool, context.tenantId, async (client) => {
      await client.query(
        "UPDATE idempotency_keys SET status = 'completed', resource_ids = $1::jsonb WHERE id = $2 AND tenant_id = $3",
        [JSON.stringify([runId]), first.claimId, context.tenantId],
      );
    });

    expect(await repository.reserveStart(context, key, hash, now)).toEqual({
      claimId: null,
      replayRunId: runId,
    });
  });

  it('allows concurrent replay of a completed reservation without a new claim', async () => {
    const key = randomUUID();
    const runId = randomUUID();
    const hash = itemHash(randomUUID());
    const now = new Date();
    const first = await repository.reserveStart(context, key, hash, now);
    await expect(
      repository.reserveStart(context, key, hash, now),
    ).rejects.toBeInstanceOf(PluggyInitialImportIdempotencyConflict);
    await withTenant(pool, context.tenantId, async (client) => {
      await client.query(
        "UPDATE idempotency_keys SET status = 'completed', resource_ids = $1::jsonb WHERE id = $2 AND tenant_id = $3",
        [JSON.stringify([runId]), first.claimId, context.tenantId],
      );
    });

    const results = await Promise.all([
      repository.reserveStart(context, key, hash, now),
      repository.reserveStart(context, key, hash, now),
    ]);
    expect(results).toEqual([
      { claimId: null, replayRunId: runId },
      { claimId: null, replayRunId: runId },
    ]);
  });

  it('rejects a different item payload under an existing key', async () => {
    const key = randomUUID();
    const now = new Date();
    await repository.reserveStart(context, key, itemHash(randomUUID()), now);
    await expect(
      repository.reserveStart(context, key, itemHash(randomUUID()), now),
    ).rejects.toBeInstanceOf(PluggyInitialImportIdempotencyConflict);
  });
});
