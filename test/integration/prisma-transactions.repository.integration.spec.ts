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
  let secondAccountId: string;
  let archivedAccountId: string;

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

    const secondAccount = await withTenant(pool, second.tenantId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO accounts (
           tenant_id, name, type, initial_balance, initial_balance_as_of
         ) VALUES ($1, $2, 'checking', '0.00', DATE '2026-09-20')
         RETURNING id`,
        [second.tenantId, `Foreign transactions account ${randomUUID()}`],
      ),
    );
    const foreignRow = secondAccount.rows[0];
    if (!foreignRow) throw new Error('Expected a foreign test account.');
    secondAccountId = foreignRow.id;

    const archivedAccount = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO accounts (
           tenant_id, name, type, initial_balance, initial_balance_as_of, archived_at
         ) VALUES ($1, $2, 'checking', '0.00', DATE '2026-09-20', CURRENT_TIMESTAMP)
         RETURNING id`,
        [first.tenantId, `Archived transactions account ${randomUUID()}`],
      ),
    );
    const archivedRow = archivedAccount.rows[0];
    if (!archivedRow) throw new Error('Expected an archived test account.');
    archivedAccountId = archivedRow.id;
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
          await client.query(
            'DELETE FROM idempotency_keys WHERE tenant_id = $1',
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

  it('claims and completes an idempotency key inside the tenant scope', async () => {
    const firstClaim = await repository.withTenant(first, (scope) =>
      scope.idempotency.claim(
        'transaction_create',
        `persistence-${randomUUID()}`,
        'a'.repeat(64),
      ),
    );
    expect(firstClaim.claimed).toBe(true);

    const repeatedClaim = await repository.withTenant(first, (scope) =>
      scope.idempotency.claim(
        firstClaim.record.operation,
        firstClaim.record.key,
        firstClaim.record.payloadHash,
      ),
    );
    expect(repeatedClaim).toMatchObject({
      claimed: false,
      record: { id: firstClaim.record.id, status: 'pending' },
    });

    await repository.withTenant(first, (scope) =>
      scope.idempotency.complete(firstClaim.record.id, [
        transactionSnapshotId(),
      ]),
    );
    const completed = await repository.withTenant(first, (scope) =>
      scope.idempotency.find(
        firstClaim.record.operation,
        firstClaim.record.key,
      ),
    );
    expect(completed).toMatchObject({
      id: firstClaim.record.id,
      status: 'completed',
      resourceIds: [expect.any(String)],
    });
  });

  it('rejects cross-tenant and archived accounts at persistence time', async () => {
    const transferId = randomUUID();
    const foreignTransaction = Transaction.createManual({
      tenantId: first.tenantId,
      accountId: secondAccountId,
      type: 'income',
      amount: '1.00',
      occurredOn: '2026-09-20',
    });
    await expectConstraintViolation(() =>
      repository.withTenant(first, (scope) =>
        scope.transactions.create(foreignTransaction),
      ),
    );

    const archivedTransaction = Transaction.createTransferEntry({
      tenantId: first.tenantId,
      accountId: archivedAccountId,
      amount: '1.00',
      occurredOn: '2026-09-20',
      transferId,
      transferSide: 'outgoing',
    });
    await expectConstraintViolation(() =>
      repository.withTenant(first, (scope) =>
        scope.transactions.create(archivedTransaction),
      ),
    );
  });

  it('rolls back a partial transfer when the unit of work fails', async () => {
    const transferId = randomUUID();
    const outgoing = Transaction.createTransferEntry({
      tenantId: first.tenantId,
      accountId,
      amount: '2.00',
      occurredOn: '2026-09-20',
      transferId,
      transferSide: 'outgoing',
    });
    await expect(
      repository.run(first, async (scope) => {
        await scope.transactions.create(outgoing);
        throw new Error('rollback transfer');
      }),
    ).rejects.toThrow('rollback transfer');

    const result = await withTenant(pool, first.tenantId, (client) =>
      client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM transactions WHERE transfer_id = $1',
        [transferId],
      ),
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  function transactionSnapshotId(): string {
    return randomUUID();
  }
});

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeDefined();
  if (!isRecord(caught) || typeof caught.code !== 'string') {
    throw new Error('Expected a database constraint error code.');
  }
  expect(['23514', 'P2039']).toContain(caught.code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
