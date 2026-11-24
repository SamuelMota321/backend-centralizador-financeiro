import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import {
  PatrimonyService,
  PatrimonyNotFound,
} from '../../src/modules/patrimony/application/patrimony.service.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { createTestPool, withTenant } from '../helpers/database.js';

describe('manual patrimony persistence and isolation', () => {
  let module: TestingModule;
  let pool: Pool;
  let service: PatrimonyService;
  let first: TenantContext;
  let second: TenantContext;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    service = module.get(PatrimonyService);
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
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (module) await module.close();
  });

  it('stores asset versions, financing association, liability, and minimal audit', async () => {
    const asset = await service.create(
      first,
      'asset',
      {
        type: 'Vehicle',
        description: 'Synthetic car',
        estimatedValue: '10000',
        valuationDate: '2026-11-01',
        source: 'Owner estimate',
      },
      randomUUID(),
    );
    const financing = await service.create(
      first,
      'financing',
      {
        description: 'Synthetic loan',
        outstandingBalance: '5000',
        assetId: asset.id,
      },
      randomUUID(),
    );
    const liability = await service.create(
      first,
      'liability',
      {
        description: 'Other synthetic debt',
        outstandingBalance: '0',
      },
      randomUUID(),
    );
    expect(financing).toMatchObject({
      assetId: asset.id,
      outstandingBalance: '5000.00',
    });
    expect(liability).toMatchObject({ outstandingBalance: '0.00' });

    const updated = await service.update(
      first,
      'asset',
      asset.id,
      { estimatedValue: '11000', valuationDate: '2026-11-02' },
      randomUUID(),
    );
    expect(updated).toMatchObject({ version: 2, estimatedValue: '11000.00' });
    const history = await service.history(first, 'asset', asset.id);
    expect(history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(history[1]?.state).toMatchObject({ estimatedValue: '10000.00' });
    expect(
      (await service.list(first, 'asset', Number.MAX_SAFE_INTEGER, 100)).items,
    ).toEqual([]);

    const audit = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ metadata: Record<string, unknown> }>(
        'SELECT metadata FROM audit_records WHERE resource_id = $1 ORDER BY created_at DESC',
        [asset.id],
      ),
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[0]?.metadata).toEqual({
      changedFields: ['estimatedValue', 'valuationDate'],
    });
    expect(JSON.stringify(audit.rows)).not.toContain('11000');
  });

  it('hides another tenant records and rejects a foreign asset association', async () => {
    const asset = await service.create(
      first,
      'asset',
      {
        type: 'Home',
        description: 'Synthetic home',
        estimatedValue: '100',
        valuationDate: '2026-11-01',
        source: 'Owner',
      },
      randomUUID(),
    );
    await expect(service.get(second, 'asset', asset.id)).rejects.toBeInstanceOf(
      PatrimonyNotFound,
    );
    await expect(
      service.history(second, 'asset', asset.id),
    ).rejects.toBeInstanceOf(PatrimonyNotFound);
    expect((await service.list(second, 'asset', 1, 20)).items).toEqual([]);
    await expect(
      service.create(
        second,
        'financing',
        {
          description: 'Foreign',
          outstandingBalance: '1',
          assetId: asset.id,
        },
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(PatrimonyNotFound);
    const visible = await withTenant(pool, second.tenantId, (client) =>
      client.query('SELECT id FROM patrimonial_assets WHERE id = $1', [
        asset.id,
      ]),
    );
    expect(visible.rowCount).toBe(0);
  });

  it('rolls back the record and revision when audit validation fails', async () => {
    const before = (await service.list(first, 'asset', 1, 20)).total;
    await expect(
      service.create(
        first,
        'asset',
        {
          type: 'Vehicle',
          description: 'Rolled back asset',
          estimatedValue: '1',
          valuationDate: '2026-11-01',
          source: 'Owner',
        },
        'invalid-request-id',
      ),
    ).rejects.toThrow();
    expect((await service.list(first, 'asset', 1, 20)).total).toBe(before);
  });
});
