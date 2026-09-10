import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };

describe('PostgreSQL RLS', () => {
  let pool: Pool;
  let first: IdentityContextRow;
  let second: IdentityContextRow;

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
    await withTenant(pool, first.tenant_id, (client) =>
      client.query(
        `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Tenant one', 'cash', '0', DATE '2026-09-08')`,
        [first.tenant_id],
      ),
    );
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
      client.query('SELECT id FROM accounts'),
    );
    const other = await withTenant(pool, second.tenant_id, (client) =>
      client.query('SELECT id FROM accounts'),
    );
    expect(own.rowCount).toBe(1);
    expect(other.rowCount).toBe(0);
  });

  it('does not inherit access when tenant context is absent', async () => {
    const result = await pool.query('SELECT id FROM accounts');
    expect(result.rowCount).toBe(0);
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
});
