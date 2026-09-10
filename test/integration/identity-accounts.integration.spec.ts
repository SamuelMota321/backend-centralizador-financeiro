import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestPool, withTenant } from '../helpers/database.js';

type IdentityContextRow = { user_id: string; tenant_id: string };

describe('identity and accounts persistence', () => {
  let pool: Pool;
  const subject = `auth0|${randomUUID()}`;
  let context: IdentityContextRow;

  beforeAll(async () => {
    pool = createTestPool();
    const result = await pool.query<IdentityContextRow>(
      "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
      ['https://tests.auth0.example/', subject],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Expected identity context.');
    context = row;
  });

  afterAll(async () => {
    if (context) {
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

  it('resolves repeated identity provisioning idempotently', async () => {
    const replay = await pool.query<IdentityContextRow>(
      "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
      ['https://tests.auth0.example/', subject],
    );
    expect(replay.rows[0]).toEqual(context);
  });

  it('resolves concurrent provisioning of the same identity once', async () => {
    const concurrentSubject = `auth0|${randomUUID()}`;
    const provision = () =>
      pool.query<IdentityContextRow>(
        "SELECT user_id, tenant_id FROM app_private.resolve_or_provision_identity('auth0', $1, $2)",
        ['https://tests.auth0.example/', concurrentSubject],
      );

    const [first, second] = await Promise.all([provision(), provision()]);
    const firstContext = first.rows[0];
    const secondContext = second.rows[0];
    expect(firstContext).toBeDefined();
    expect(secondContext).toEqual(firstContext);

    if (!firstContext) throw new Error('Expected concurrent identity context.');
    await withTenant(pool, firstContext.tenant_id, async (client) => {
      await client.query('DELETE FROM identity_links WHERE user_id = $1', [
        firstContext.user_id,
      ]);
      await client.query('DELETE FROM users WHERE id = $1', [
        firstContext.user_id,
      ]);
      await client.query('DELETE FROM tenants WHERE id = $1', [
        firstContext.tenant_id,
      ]);
    });
  });

  it('persists an owned account with exact money', async () => {
    const result = await withTenant(pool, context.tenant_id, (client) =>
      client.query<{ initial_balance: string }>(
        `INSERT INTO accounts (tenant_id, name, type, initial_balance, initial_balance_as_of)
         VALUES ($1, 'Conta teste', 'checking', '-10.25', DATE '2026-09-08')
         RETURNING initial_balance`,
        [context.tenant_id],
      ),
    );
    expect(result.rows[0]?.initial_balance).toBe('-10.25');
  });

  it('rejects a second user for the tenant', async () => {
    await expect(
      withTenant(pool, context.tenant_id, (client) =>
        client.query('INSERT INTO users (tenant_id) VALUES ($1)', [
          context.tenant_id,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
