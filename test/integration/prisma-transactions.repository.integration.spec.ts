import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaTransactionsRepository } from '../../src/modules/transactions/adapters/outbound/prisma-transactions.repository.js';
import { CategoryRule } from '../../src/modules/transactions/domain/category-rule.js';
import { Category } from '../../src/modules/transactions/domain/category.js';
import { Transaction } from '../../src/modules/transactions/domain/transaction.js';
import type { TenantContext } from '../../src/shared/application/tenant-context.js';
import { PrismaIdentityContextResolver } from '../../src/modules/identity/adapters/outbound/prisma-identity-context-resolver.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import { createTestPool, withTenant } from '../helpers/database.js';

describe('PrismaTransactionsRepository', () => {
  let module: TestingModule;
  let pool: Pool;
  let repository: PrismaTransactionsRepository;
  let first: TenantContext;
  let second: TenantContext;
  let accountId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await module.init();
    pool = createTestPool();
    repository = module.get(PrismaTransactionsRepository);
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

    const result = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO accounts (
           tenant_id, name, type, initial_balance, initial_balance_as_of
         ) VALUES ($1, $2, 'checking', '0.00', DATE '2026-09-20')
         RETURNING id`,
        [first.tenantId, `Transactions repository ${randomUUID()}`],
      ),
    );
    const row = result.rows[0];
    if (!row) throw new Error('Expected a test account.');
    accountId = row.id;
  });

  afterAll(async () => {
    if (pool) {
      for (const context of [first, second]) {
        if (!context) continue;
        await withTenant(pool, context.tenantId, async (client) => {
          await client.query(
            'DELETE FROM category_rules WHERE tenant_id = $1',
            [context.tenantId],
          );
          await client.query('DELETE FROM transactions WHERE tenant_id = $1', [
            context.tenantId,
          ]);
          await client.query('DELETE FROM categories WHERE tenant_id = $1', [
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

  it('maps exact values and scopes all repositories to the tenant context', async () => {
    const category = Category.create({
      tenantId: first.tenantId,
      name: `Mercado ${randomUUID()}`,
    });
    const categorySnapshot = await repository.withTenant(first, (scope) =>
      scope.categories.create(category),
    );
    const rule = CategoryRule.create({
      tenantId: first.tenantId,
      categoryId: categorySnapshot.id,
      conditionField: 'description',
      conditionOperator: 'contains',
      conditionValue: 'mercado',
      priority: 10,
    });
    const ruleSnapshot = await repository.withTenant(first, (scope) =>
      scope.categoryRules.create(rule),
    );
    const transaction = Transaction.createManual({
      tenantId: first.tenantId,
      accountId,
      type: 'expense',
      amount: '12.30',
      occurredOn: '2026-09-20',
      description: 'Mercado semanal',
    });
    const transactionSnapshot = await repository.withTenant(first, (scope) =>
      scope.transactions.create(transaction),
    );

    expect(categorySnapshot).toMatchObject({
      tenantId: first.tenantId,
      name: category.props.name,
      status: 'active',
    });
    expect(ruleSnapshot).toMatchObject({
      tenantId: first.tenantId,
      categoryId: categorySnapshot.id,
      conditionField: 'description',
      conditionOperator: 'contains',
      priority: 10,
    });
    expect(transactionSnapshot).toMatchObject({
      tenantId: first.tenantId,
      accountId,
      amount: '12.30',
      occurredOn: '2026-09-20',
      description: 'Mercado semanal',
    });

    const foreign = await repository.withTenant(second, async (scope) =>
      Promise.all([
        scope.categories.findById(categorySnapshot.id),
        scope.categoryRules.findById(ruleSnapshot.id),
        scope.transactions.findById(transactionSnapshot.id),
      ]),
    );
    expect(foreign).toEqual([null, null, null]);
  });

  it('does not persist an invalid amount through the database constraint', async () => {
    await expect(
      withTenant(pool, first.tenantId, (client) =>
        client.query(
          `INSERT INTO transactions (
             tenant_id, account_id, type, amount, occurred_on,
             categorization_status
           ) VALUES ($1, $2, 'expense', '0.00', DATE '2026-09-20', 'unclassified')`,
          [first.tenantId, accountId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
