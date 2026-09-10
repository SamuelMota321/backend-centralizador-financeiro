import { Pool, type PoolClient } from 'pg';

export function createTestPool(): Pool {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for database integration tests.',
    );
  }
  return new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 });
}

export async function withTenant<Result>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      tenantId,
    ]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
