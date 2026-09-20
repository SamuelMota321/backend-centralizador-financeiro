import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };

describe('Transactions foundation PostgreSQL RLS', () => {
  let pool: Pool;
  let first: IdentityContextRow;
  let second: IdentityContextRow;
  let accountId: string;
  let categoryId: string;
  let transactionId: string;
  let ruleId: string;

  beforeAll(async () => {
    pool = createTestPool();
    const subjects = [`auth0|${randomUUID()}`, `auth0|${randomUUID()}`];
    const contexts = await Promise.all(
      subjects.map(async (subject) => {
        const result = await pool.query<IdentityContextRow>(
          "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
          ['https://tests.auth0.example/', subject],
        );
        const row = result.rows[0];
        if (!row) throw new Error('Expected identity context.');
        return row;
      }),
    );
    [first, second] = contexts as [IdentityContextRow, IdentityContextRow];

    const result = await withTenant(pool, first.tenant_id, async (client) => {
      const account = await client.query<{ id: string }>(
        `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Transactions RLS account', 'cash', '0', DATE '2026-09-20')
         RETURNING id`,
        [first.tenant_id],
      );
      const insertedAccount = account.rows[0];
      if (!insertedAccount) throw new Error('Expected test account.');

      const category = await client.query<{ id: string }>(
        `INSERT INTO categories (tenant_id, name)
         VALUES ($1, 'Transactions RLS category')
         RETURNING id`,
        [first.tenant_id],
      );
      const insertedCategory = category.rows[0];
      if (!insertedCategory) throw new Error('Expected test category.');

      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions (
           tenant_id, account_id, type, amount, occurred_on, category_id,
           categorization_status, categorization_source
         ) VALUES ($1, $2, 'income', '10.00', DATE '2026-09-20', $3, 'categorized', 'manual')
         RETURNING id`,
        [first.tenant_id, insertedAccount.id, insertedCategory.id],
      );
      const insertedTransaction = transaction.rows[0];
      if (!insertedTransaction) throw new Error('Expected test transaction.');

      const rule = await client.query<{ id: string }>(
        `INSERT INTO category_rules (
           tenant_id, category_id, condition_field, condition_operator, condition_value
         ) VALUES ($1, $2, 'description', 'contains', 'RLS')
         RETURNING id`,
        [first.tenant_id, insertedCategory.id],
      );
      const insertedRule = rule.rows[0];
      if (!insertedRule) throw new Error('Expected test category rule.');

      return {
        accountId: insertedAccount.id,
        categoryId: insertedCategory.id,
        transactionId: insertedTransaction.id,
        ruleId: insertedRule.id,
      };
    });

    accountId = result.accountId;
    categoryId = result.categoryId;
    transactionId = result.transactionId;
    ruleId = result.ruleId;
  });

  afterAll(async () => {
    if (!pool) return;
    for (const context of [first, second]) {
      if (!context) continue;
      await withTenant(pool, context.tenant_id, async (client) => {
        await client.query('DELETE FROM category_rules WHERE tenant_id = $1', [
          context.tenant_id,
        ]);
        await client.query('DELETE FROM transactions WHERE tenant_id = $1', [
          context.tenant_id,
        ]);
        await client.query('DELETE FROM categories WHERE tenant_id = $1', [
          context.tenant_id,
        ]);
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
    await pool.end();
  });

  it('shows owned foundation rows and hides another tenant rows', async () => {
    const own = await withTenant(pool, first.tenant_id, (client) =>
      Promise.all([
        client.query('SELECT id FROM categories WHERE id = $1', [categoryId]),
        client.query('SELECT id FROM transactions WHERE id = $1', [
          transactionId,
        ]),
        client.query('SELECT id FROM category_rules WHERE id = $1', [ruleId]),
      ]),
    );
    const other = await withTenant(pool, second.tenant_id, (client) =>
      Promise.all([
        client.query('SELECT id FROM categories WHERE id = $1', [categoryId]),
        client.query('SELECT id FROM transactions WHERE id = $1', [
          transactionId,
        ]),
        client.query('SELECT id FROM category_rules WHERE id = $1', [ruleId]),
      ]),
    );

    expect(own.map((result) => result.rowCount)).toEqual([1, 1, 1]);
    expect(other.map((result) => result.rowCount)).toEqual([0, 0, 0]);
  });

  it('rejects cross-tenant inserts and denies cross-tenant updates', async () => {
    await expect(
      withTenant(pool, second.tenant_id, (client) =>
        client.query(
          'INSERT INTO categories (tenant_id, name) VALUES ($1, $2)',
          [first.tenant_id, 'Foreign category'],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const results = await withTenant(pool, second.tenant_id, (client) =>
      Promise.all([
        client.query('UPDATE categories SET name = $1 WHERE id = $2', [
          'Foreign category update',
          categoryId,
        ]),
        client.query('UPDATE transactions SET description = $1 WHERE id = $2', [
          'Foreign transaction update',
          transactionId,
        ]),
        client.query('UPDATE category_rules SET priority = 1 WHERE id = $1', [
          ruleId,
        ]),
      ]),
    );
    expect(results.map((result) => result.rowCount)).toEqual([0, 0, 0]);
  });

  it('fails closed without tenant context', async () => {
    const results = await Promise.all([
      pool.query('SELECT id FROM categories WHERE id = $1', [categoryId]),
      pool.query('SELECT id FROM transactions WHERE id = $1', [transactionId]),
      pool.query('SELECT id FROM category_rules WHERE id = $1', [ruleId]),
    ]);
    expect(results.map((result) => result.rowCount)).toEqual([0, 0, 0]);
  });

  it('does not allow the runtime contract to create a zero-value transaction', async () => {
    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO transactions (
             tenant_id, account_id, type, amount, occurred_on,
             categorization_status
           ) VALUES ($1, $2, 'expense', '0', DATE '2026-09-20', 'unclassified')`,
          [first.tenant_id, accountId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
