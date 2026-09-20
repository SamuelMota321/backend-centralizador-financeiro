import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaAccountsRepository } from '../../src/modules/accounts/adapters/outbound/prisma-accounts.repository.js';
import { Account } from '../../src/modules/accounts/domain/account.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { createTestPool, withTenant } from '../helpers/database.js';

describe('PrismaAccountsRepository', () => {
  let module: TestingModule;
  let pool: Pool;
  let repository: PrismaAccountsRepository;
  let first: TenantContext;
  let second: TenantContext;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    pool = createTestPool();
    repository = module.get(PrismaAccountsRepository);
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
    for (const context of [first, second]) {
      if (!context) continue;
      await withTenant(pool, context.tenantId, async (client) => {
        await client.query('DELETE FROM accounts WHERE tenant_id = $1', [
          context.tenantId,
        ]);
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

  it('persists exact money and returns only the owning tenant account', async () => {
    const account = Account.createManual({
      tenantId: first.tenantId,
      name: 'Conta Principal',
      type: 'checking',
      institutionName: 'Banco Teste',
      initialBalance: '-10.25',
      initialBalanceAsOf: '2026-09-01',
    });

    const created = await repository.withTenant(first, (accounts) =>
      accounts.createManual(account),
    );
    expect(created.initialBalance).toBe('-10.25');

    const own = await repository.withTenant(first, (accounts) =>
      accounts.findActive(0, 20),
    );
    const other = await repository.withTenant(second, (accounts) =>
      accounts.findActive(0, 20),
    );
    expect(own.map(({ id }) => id)).toContain(created.id);
    expect(other).toEqual([]);
  });

  it('updates and deactivates an account through the repository contract', async () => {
    const account = Account.createManual({
      tenantId: first.tenantId,
      name: `Conta de Manutenção ${randomUUID()}`,
      type: 'cash',
      initialBalance: '10.00',
      initialBalanceAsOf: '2026-09-01',
    });

    const created = await repository.withTenant(first, (accounts) =>
      accounts.createManual(account),
    );
    const snapshot = await repository.withTenant(first, (accounts) =>
      accounts.findByIdForUpdate(created.id),
    );
    if (!snapshot) throw new Error('Expected the created account snapshot.');

    const updated = await repository.withTenant(first, (accounts) =>
      accounts.update(
        created.id,
        Account.reconstitute(snapshot).update({
          name: 'Conta de Manutenção Atualizada',
          initialBalance: '12.00',
          initialBalanceAsOf: '2026-09-02',
        }),
      ),
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Conta de Manutenção Atualizada',
      initialBalance: '12.00',
      initialBalanceAsOf: '2026-09-02',
      archivedAt: null,
    });

    const deactivated = await repository.withTenant(first, (accounts) =>
      accounts.deactivate(created.id),
    );
    expect(deactivated.archivedAt).toEqual(expect.any(String));

    const active = await repository.withTenant(first, (accounts) =>
      accounts.findActive(0, 100),
    );
    expect(active.map(({ id }) => id)).not.toContain(created.id);
  });

  it('finds only an active connected account with the exact normalized key', async () => {
    await withTenant(pool, first.tenantId, (client) =>
      client.query(
        `INSERT INTO accounts (
           tenant_id, name, type, origin, institution_name,
           initial_balance, initial_balance_as_of, external_provider, external_account_id
         ) VALUES ($1, 'Conta Conectada', 'savings', 'connected', 'Banco Teste',
                   '100.00', DATE '2026-09-01', 'pluggy', $2)`,
        [first.tenantId, `external-${randomUUID()}`],
      ),
    );
    const candidate = Account.createManual({
      tenantId: first.tenantId,
      name: '  Conta   Conectada ',
      type: 'savings',
      institutionName: ' Banco Teste ',
      initialBalance: '0.00',
      initialBalanceAsOf: '2026-09-01',
    });

    const matches = await repository.withTenant(first, (accounts) =>
      accounts.findPossibleConnectedDuplicates(candidate),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      name: 'Conta Conectada',
      type: 'savings',
      origin: 'connected',
      institutionName: 'Banco Teste',
    });
  });
});
