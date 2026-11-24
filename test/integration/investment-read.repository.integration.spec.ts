import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaInvestmentReadRepository } from '../../src/modules/investments/adapters/outbound/prisma-investment-read.repository.js';
import { PrismaPluggySyncRepository } from '../../src/modules/sync/adapters/outbound/prisma-pluggy-sync.repository.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { createTestPool, withTenant } from '../helpers/database.js';

describe('investment read isolation', () => {
  let module: TestingModule;
  let pool: Pool;
  let repository: PrismaInvestmentReadRepository;
  let syncRepository: PrismaPluggySyncRepository;
  let first: TenantContext;
  let second: TenantContext;
  const connectionId = randomUUID();
  const runId = randomUUID();
  const failedRunId = randomUUID();
  const positionId = randomUUID();

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    pool = createTestPool();
    repository = module.get(PrismaInvestmentReadRepository);
    syncRepository = module.get(PrismaPluggySyncRepository);
    const identities = module.get(PrismaIdentityContextResolver);
    first = await identities.resolveOrProvision(
      ExternalIdentity.auth0(
        'https://investments.auth0.example/',
        `auth0|${randomUUID()}`,
      ),
    );
    second = await identities.resolveOrProvision(
      ExternalIdentity.auth0(
        'https://investments.auth0.example/',
        `auth0|${randomUUID()}`,
      ),
    );
    await withTenant(pool, first.tenantId, async (client) => {
      await client.query(
        `INSERT INTO connections
          (id, tenant_id, owner_user_id, provider, provider_item_id, status,
           consent_status, consent_products)
         VALUES ($1, $2, $3, 'pluggy', $4, 'connected', 'granted', $5)`,
        [
          connectionId,
          first.tenantId,
          first.userId,
          randomUUID(),
          ['INVESTMENTS', 'INVESTMENTS_TRANSACTIONS'],
        ],
      );
      await client.query(
        `INSERT INTO pluggy_sync_runs
          (id, tenant_id, connection_id, owner_user_id, trigger, status,
           investments_complete, movements_complete, completed_at, retention_expires_at)
         VALUES ($1, $2, $3, $4, 'manual', 'succeeded', TRUE, TRUE,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
        [runId, first.tenantId, connectionId, first.userId],
      );
      await client.query(
        `INSERT INTO pluggy_investments
          (id, tenant_id, connection_id, provider_id, name, type, status,
           balance, currency_code, reference_date, last_seen_run_id)
         VALUES ($1, $2, $3, 'synthetic-position', 'CDB sintético',
                 'FIXED_INCOME', 'ACTIVE', 100.10, 'BRL', CURRENT_TIMESTAMP, $4)`,
        [positionId, first.tenantId, connectionId, runId],
      );
      await client.query(
        `INSERT INTO pluggy_investment_movements
          (tenant_id, connection_id, investment_id, provider_id, type,
           amount, occurred_at, last_seen_run_id)
         VALUES ($1, $2, $3, 'synthetic-movement', 'BUY', NULL,
                 CURRENT_TIMESTAMP, $4)`,
        [first.tenantId, connectionId, positionId, runId],
      );
    });
  });

  afterAll(async () => {
    if (pool && first) {
      await withTenant(pool, first.tenantId, async (client) => {
        for (const table of [
          'pluggy_investment_movements',
          'pluggy_investments',
          'pluggy_sync_runs',
        ]) {
          await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [
            first.tenantId,
          ]);
        }
      });
    }
    // shortcut: cfi_test cannot delete connections; dispose the isolated test database after this suite.
    if (pool) await pool.end();
    if (module) await module.close();
  });

  it('reads only the owner tenant and rejects cross-tenant movement access', async () => {
    const own = await repository.collections(first);
    expect(own[0]?.positions[0]).toMatchObject({
      id: positionId,
      externalId: 'synthetic-position',
      balance: '100.1',
    });
    expect(
      (await repository.movements(first, positionId))?.movements[0],
    ).toMatchObject({ amount: null, externalId: 'synthetic-movement' });
    expect(await repository.collections(second)).toEqual([]);
    expect(await repository.movements(second, positionId)).toBeNull();
    const crossTenantRows = await withTenant(
      pool,
      second.tenantId,
      async (client) =>
        client.query('SELECT id FROM pluggy_investments WHERE id = $1', [
          positionId,
        ]),
    );
    expect(crossTenantRows.rows).toEqual([]);
  });

  it('preserves provider status, annual rate, run provenance and nullable movement amount', async () => {
    const nextRunId = randomUUID();
    await withTenant(pool, first.tenantId, async (client) => {
      await client.query(
        `INSERT INTO pluggy_sync_runs
          (id, tenant_id, connection_id, owner_user_id, trigger)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [nextRunId, first.tenantId, connectionId, first.userId],
      );
    });
    expect((await repository.collections(first))[0]).toMatchObject({
      latestRunId: nextRunId,
      completeRunId: runId,
      positions: [{ balance: '100.1' }],
    });
    await syncRepository.finish(first, nextRunId, 'succeeded', [], new Date(), {
      investmentsComplete: true,
      movementsComplete: true,
      investments: [
        {
          investment: {
            id: 'synthetic-position',
            name: 'CDB sintético',
            type: 'FIXED_INCOME',
            status: 'ACTIVE',
            subtype: 'CDB',
            balance: '101.25',
            currencyCode: 'BRL',
            quantity: null,
            amount: '102.00',
            amountOriginal: '90.00',
            amountProfit: null,
            institutionName: null,
            rate: '110',
            rateType: 'CDI',
            fixedAnnualRate: '10.5',
            maturityDate: null,
            date: new Date().toISOString(),
          },
          movements: [
            {
              id: 'synthetic-movement',
              type: 'BUY',
              amount: null,
              date: new Date().toISOString(),
            },
          ],
        },
      ],
    });
    expect(
      (await repository.collections(first))[0]?.positions[0],
    ).toMatchObject({
      providerStatus: 'ACTIVE',
      fixedAnnualRate: '10.5',
      investedAmount: '90',
      balance: '101.25',
      lastSeenRunId: nextRunId,
    });
    expect(
      (await repository.movements(first, positionId))?.movements[0]?.amount,
    ).toBeNull();
  });

  it('rolls back a failed publication without overwriting the last complete position', async () => {
    await withTenant(pool, first.tenantId, async (client) => {
      await client.query(
        `INSERT INTO pluggy_sync_runs
          (id, tenant_id, connection_id, owner_user_id, trigger)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [failedRunId, first.tenantId, connectionId, first.userId],
      );
    });
    await expect(
      syncRepository.finish(first, failedRunId, 'succeeded', [], new Date(), {
        investmentsComplete: true,
        movementsComplete: true,
        investments: [
          {
            investment: {
              id: 'synthetic-position',
              name: 'CDB sintético',
              type: 'FIXED_INCOME',
              status: 'ACTIVE',
              subtype: 'CDB',
              balance: '999.00',
              currencyCode: 'BRL',
              quantity: null,
              amount: null,
              amountOriginal: null,
              amountProfit: null,
              institutionName: null,
              rate: null,
              rateType: null,
              fixedAnnualRate: null,
              maturityDate: null,
              date: new Date().toISOString(),
            },
            movements: [
              {
                id: 'invalid-movement',
                type: 'BUY',
                amount: '1.00',
                date: 'invalid-date',
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
    expect((await repository.collections(first))[0]).toMatchObject({
      latestRunId: failedRunId,
      positions: [{ balance: '101.25', providerStatus: 'ACTIVE' }],
    });
  });

  it('does not publish collected positions after consent is revoked', async () => {
    await withTenant(pool, first.tenantId, async (client) => {
      await client.query(
        `UPDATE connections SET consent_status = 'revoked',
          consent_revoked_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [connectionId],
      );
    });
    await syncRepository.finish(
      first,
      failedRunId,
      'succeeded',
      [],
      new Date(),
      {
        investmentsComplete: true,
        movementsComplete: true,
        investments: [
          {
            investment: {
              id: 'synthetic-position',
              name: 'CDB sintético',
              type: 'FIXED_INCOME',
              status: 'ACTIVE',
              subtype: 'CDB',
              balance: '999.00',
              currencyCode: 'BRL',
              quantity: null,
              amount: null,
              amountOriginal: null,
              amountProfit: null,
              institutionName: null,
              rate: null,
              rateType: null,
              fixedAnnualRate: null,
              maturityDate: null,
              date: new Date().toISOString(),
            },
            movements: [],
          },
        ],
      },
    );
    expect((await repository.collections(first))[0]).toMatchObject({
      authorized: false,
      positions: [],
    });
    const rows = await withTenant(pool, first.tenantId, async (client) =>
      client.query<{
        balance: string;
        status: string;
        investments_complete: boolean;
        reasons: Array<{ dataType: string; code: string }>;
      }>(
        `SELECT i.balance::text AS balance, r.status::text AS status,
                r.investments_complete, r.reasons
         FROM pluggy_investments i JOIN pluggy_sync_runs r ON r.id = $1
         WHERE i.id = $2`,
        [failedRunId, positionId],
      ),
    );
    expect(rows.rows[0]).toMatchObject({
      balance: '101.25',
      status: 'partial',
      investments_complete: false,
    });
    expect(rows.rows[0]?.reasons).toEqual([
      { dataType: 'investments', code: 'unavailable' },
      { dataType: 'investment_transactions', code: 'unavailable' },
    ]);
  });
});
