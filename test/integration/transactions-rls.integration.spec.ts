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
  let secondAccountId: string;
  let secondCategoryId: string;
  let archivedAccountId: string;

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

      const archivedAccount = await client.query<{ id: string }>(
        `INSERT INTO accounts (
           tenant_id, name, type, initial_balance, initial_balance_as_of,
           archived_at
         ) VALUES ($1, 'Transactions RLS archived account', 'cash', '0', DATE '2026-09-20', CURRENT_TIMESTAMP)
         RETURNING id`,
        [first.tenant_id],
      );
      const insertedArchivedAccount = archivedAccount.rows[0];
      if (!insertedArchivedAccount)
        throw new Error('Expected archived account.');

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
        archivedAccountId: insertedArchivedAccount.id,
        categoryId: insertedCategory.id,
        transactionId: insertedTransaction.id,
        ruleId: insertedRule.id,
      };
    });

    accountId = result.accountId;
    archivedAccountId = result.archivedAccountId;
    categoryId = result.categoryId;
    transactionId = result.transactionId;
    ruleId = result.ruleId;

    const secondFixtures = await withTenant(
      pool,
      second.tenant_id,
      async (client) => {
        const account = await client.query<{ id: string }>(
          `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Transactions RLS foreign account', 'cash', '0', DATE '2026-09-20')
         RETURNING id`,
          [second.tenant_id],
        );
        const category = await client.query<{ id: string }>(
          `INSERT INTO categories (tenant_id, name)
         VALUES ($1, 'Transactions RLS foreign category')
         RETURNING id`,
          [second.tenant_id],
        );
        const insertedAccount = account.rows[0];
        const insertedCategory = category.rows[0];
        if (!insertedAccount || !insertedCategory) {
          throw new Error('Expected second-tenant fixtures.');
        }
        return {
          accountId: insertedAccount.id,
          categoryId: insertedCategory.id,
        };
      },
    );
    secondAccountId = secondFixtures.accountId;
    secondCategoryId = secondFixtures.categoryId;
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
    const own = await withTenant(pool, first.tenant_id, async (client) => [
      await client.query('SELECT id FROM categories WHERE id = $1', [
        categoryId,
      ]),
      await client.query('SELECT id FROM transactions WHERE id = $1', [
        transactionId,
      ]),
      await client.query('SELECT id FROM category_rules WHERE id = $1', [
        ruleId,
      ]),
    ]);
    const other = await withTenant(pool, second.tenant_id, async (client) => [
      await client.query('SELECT id FROM categories WHERE id = $1', [
        categoryId,
      ]),
      await client.query('SELECT id FROM transactions WHERE id = $1', [
        transactionId,
      ]),
      await client.query('SELECT id FROM category_rules WHERE id = $1', [
        ruleId,
      ]),
    ]);

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

    const results = await withTenant(pool, second.tenant_id, async (client) => [
      await client.query('UPDATE categories SET name = $1 WHERE id = $2', [
        'Foreign category update',
        categoryId,
      ]),
      await client.query(
        'UPDATE transactions SET description = $1 WHERE id = $2',
        ['Foreign transaction update', transactionId],
      ),
      await client.query(
        'UPDATE category_rules SET priority = 1 WHERE id = $1',
        [ruleId],
      ),
    ]);
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

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO category_rules (
             tenant_id, category_id, condition_field, condition_operator, condition_value
           ) VALUES ($1, $2, 'account_id', 'equals', $3)`,
          [first.tenant_id, categoryId, archivedAccountId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('pins the category rule priority ceiling in PostgreSQL', async () => {
    const result = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.category_rules'::regclass
         AND conname = 'category_rules_priority_check'`,
    );

    expect(result.rows[0]?.definition).toContain('2147483647');
  });

  it('rejects cross-tenant category and rule references in direct SQL', async () => {
    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO transactions (
             tenant_id, account_id, type, amount, occurred_on, category_id,
             categorization_status, categorization_source
           ) VALUES ($1, $2, 'income', '1.00', DATE '2026-09-20', $3, 'categorized', 'manual')`,
          [first.tenant_id, accountId, secondCategoryId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO category_rules (
             tenant_id, category_id, condition_field, condition_operator, condition_value
           ) VALUES ($1, $2, 'description', 'contains', 'foreign category')`,
          [first.tenant_id, secondCategoryId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO category_rules (
             tenant_id, category_id, condition_field, condition_operator, condition_value
           ) VALUES ($1, $2, 'account_id', 'equals', $3)`,
          [first.tenant_id, categoryId, secondAccountId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('preserves archived category history and rejects new archived references', async () => {
    await withTenant(pool, first.tenant_id, (client) =>
      client.query(
        `UPDATE categories
         SET status = 'archived', archived_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [categoryId],
      ),
    );

    const historicalRows = await withTenant(
      pool,
      first.tenant_id,
      async (client) => {
        const transaction = await client.query<{ category_id: string }>(
          'UPDATE transactions SET category_id = $1 WHERE id = $2 RETURNING category_id',
          [categoryId, transactionId],
        );
        const rule = await client.query<{
          category_id: string;
          condition_value: string;
        }>(
          `UPDATE category_rules
           SET condition_value = 'updated after archive'
           WHERE id = $1
           RETURNING category_id, condition_value`,
          [ruleId],
        );
        return { transaction: transaction.rows[0], rule: rule.rows[0] };
      },
    );

    expect(historicalRows.transaction?.category_id).toBe(categoryId);
    expect(historicalRows.rule).toMatchObject({
      category_id: categoryId,
      condition_value: 'updated after archive',
    });

    const newReferences = await withTenant(
      pool,
      first.tenant_id,
      async (client) => {
        const transaction = await client.query<{ id: string }>(
          `INSERT INTO transactions (
             tenant_id, account_id, type, amount, occurred_on,
             categorization_status
           ) VALUES ($1, $2, 'income', '1.00', DATE '2026-09-20', 'unclassified')
           RETURNING id`,
          [first.tenant_id, accountId],
        );
        const alternateCategory = await client.query<{ id: string }>(
          `INSERT INTO categories (tenant_id, name)
           VALUES ($1, 'Transactions RLS alternate category')
           RETURNING id`,
          [first.tenant_id],
        );
        const categoryRule = await client.query<{ id: string }>(
          `INSERT INTO category_rules (
             tenant_id, category_id, condition_field, condition_operator,
             condition_value
           ) VALUES ($1, $2, 'description', 'contains', 'alternate')
           RETURNING id`,
          [first.tenant_id, alternateCategory.rows[0]?.id],
        );
        const transactionRow = transaction.rows[0];
        const ruleRow = categoryRule.rows[0];
        if (!transactionRow || !ruleRow) {
          throw new Error('Expected archived-reference test fixtures.');
        }
        return { transactionId: transactionRow.id, ruleId: ruleRow.id };
      },
    );

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [
          categoryId,
          newReferences.transactionId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          'UPDATE category_rules SET category_id = $1 WHERE id = $2',
          [categoryId, newReferences.ruleId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO category_rules (
             tenant_id, category_id, condition_field, condition_operator,
             condition_value
           ) VALUES ($1, $2, 'description', 'contains', 'archived')`,
          [first.tenant_id, categoryId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
