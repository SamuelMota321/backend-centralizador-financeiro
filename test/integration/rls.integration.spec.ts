import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };

describe('PostgreSQL RLS', () => {
  let pool: Pool;
  let first: IdentityContextRow;
  let second: IdentityContextRow;
  let accountId: string;
  let secondAccountId: string;

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
    const account = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Tenant one', 'cash', '0', DATE '2026-09-08')
         RETURNING id`,
        [first.tenant_id],
      ),
    );
    const insertedAccount = account.rows[0];
    if (!insertedAccount) throw new Error('Expected the RLS test account.');
    accountId = insertedAccount.id;
    const foreignAccount = await withTenant(pool, second.tenant_id, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Tenant two', 'cash', '0', DATE '2026-09-08')
         RETURNING id`,
        [second.tenant_id],
      ),
    );
    const insertedForeignAccount = foreignAccount.rows[0];
    if (!insertedForeignAccount)
      throw new Error('Expected tenant two account.');
    secondAccountId = insertedForeignAccount.id;
  });

  afterAll(async () => {
    for (const context of [first, second]) {
      if (!context) continue;
      await withTenant(pool, context.tenant_id, async (client) => {
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
    if (pool) await pool.end();
  });

  it('shows owned rows and hides another tenant rows', async () => {
    const own = await withTenant(pool, first.tenant_id, (client) =>
      client.query<{ id: string }>('SELECT id FROM accounts'),
    );
    const other = await withTenant(pool, second.tenant_id, (client) =>
      client.query<{ id: string }>('SELECT id FROM accounts'),
    );
    expect(own.rowCount).toBe(1);
    expect(own.rows[0]?.id).toBe(accountId);
    expect(other.rowCount).toBe(1);
    expect(other.rows[0]?.id).toBe(secondAccountId);
    expect(other.rows[0]?.id).not.toBe(accountId);
  });

  it('does not inherit access when tenant context is absent', async () => {
    const result = await pool.query('SELECT id FROM accounts');
    expect(result.rowCount).toBe(0);
  });

  it('clears transaction-local tenant context before a pooled connection is reused', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [first.tenant_id],
      );
      await expect(
        client.query('SELECT id FROM accounts'),
      ).resolves.toMatchObject({
        rowCount: 1,
      });
      await client.query('COMMIT');

      await client.query('BEGIN');
      await expect(
        client.query('SELECT id FROM accounts'),
      ).resolves.toMatchObject({
        rowCount: 0,
      });
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [second.tenant_id],
      );
      await expect(
        client.query('SELECT id FROM accounts'),
      ).resolves.toMatchObject({
        rowCount: 1,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('rejects cross-tenant ownership on insert', async () => {
    await expect(
      withTenant(pool, second.tenant_id, (client) =>
        client.query(
          `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
           VALUES ($1, 'Foreign', 'cash', '0', DATE '2026-09-08')`,
          [first.tenant_id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies cross-tenant update and delete', async () => {
    await expect(
      withTenant(pool, second.tenant_id, (client) =>
        client.query('UPDATE accounts SET name = $1 WHERE id = $2', [
          'Foreign update',
          accountId,
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    await expect(
      withTenant(pool, second.tenant_id, (client) =>
        client.query('DELETE FROM accounts WHERE id = $1', [accountId]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it('fails closed for malformed tenant context', async () => {
    await expect(
      withTenant(pool, 'not-a-uuid', (client) =>
        client.query('SELECT id FROM accounts'),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });

    await expect(
      withTenant(pool, 'not-a-uuid', (client) =>
        client.query(
          `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
           VALUES ($1, 'Malformed context', 'cash', '0', DATE '2026-09-08')`,
          [first.tenant_id],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('isolates audit records and rejects cross-tenant audit writes', async () => {
    const requestId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [first.tenant_id],
      );
      await client.query(
        `INSERT INTO audit_records (
           tenant_id, actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata
         ) VALUES ($1, $2, 'account_updated', 'account', $3, 'success', $4, $5::jsonb)`,
        [
          first.tenant_id,
          first.user_id,
          accountId,
          requestId,
          JSON.stringify({ changedFields: ['name'] }),
        ],
      );

      const own = await client.query(
        'SELECT id FROM audit_records WHERE resource_id = $1',
        [accountId],
      );
      expect(own.rowCount).toBe(1);

      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [second.tenant_id],
      );
      const other = await client.query(
        'SELECT id FROM audit_records WHERE resource_id = $1',
        [accountId],
      );
      expect(other.rowCount).toBe(0);

      await expect(
        client.query(
          `INSERT INTO audit_records (
             tenant_id, actor_user_id, action, resource_type, resource_id, outcome, request_id, metadata
           ) VALUES ($1, $2, 'account_updated', 'account', $3, 'success', $4, '{}'::jsonb)`,
          [first.tenant_id, first.user_id, accountId, randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  it('rejects audit records with a foreign actor or resource even under the current tenant', async () => {
    const foreignResource = await withTenant(pool, second.tenant_id, (client) =>
      client.query<{ id: string }>('SELECT id FROM accounts WHERE id = $1', [
        secondAccountId,
      ]),
    );
    const secondAccount = foreignResource.rows[0];
    if (!secondAccount) throw new Error('Expected tenant two account.');

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO audit_records (
             tenant_id, actor_user_id, action, resource_type, resource_id,
             outcome, request_id, metadata
           ) VALUES ($1, $2, 'account_updated', 'account', $3, 'success', $4, $5::jsonb)`,
          [
            first.tenant_id,
            second.user_id,
            accountId,
            randomUUID(),
            JSON.stringify({ changedFields: ['name'] }),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withTenant(pool, first.tenant_id, (client) =>
        client.query(
          `INSERT INTO audit_records (
             tenant_id, actor_user_id, action, resource_type, resource_id,
             outcome, request_id, metadata
           ) VALUES ($1, $2, 'account_updated', 'account', $3, 'success', $4, $5::jsonb)`,
          [
            first.tenant_id,
            first.user_id,
            secondAccount.id,
            randomUUID(),
            JSON.stringify({ changedFields: ['name'] }),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
