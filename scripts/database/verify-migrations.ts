import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number;
};

type ProtectedTableRow = {
  table_name: string;
  owner: string;
  row_security: boolean;
  force_row_security: boolean;
};

type RoleRow = {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
};

type RoleTransition = {
  migration_name: string;
  set_role_count: number;
  reset_role_count: number;
};

const databaseUrl = process.env.DIRECT_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DIRECT_DATABASE_URL is required for migration verification.',
  );
}

const migrationsDirectory = resolve(
  fileURLToPath(new URL('../../prisma/migrations/', import.meta.url)),
);
const migrationEntries = await readdir(migrationsDirectory, {
  withFileTypes: true,
});
const expectedMigrations = migrationEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const roleTransitions: RoleTransition[] = [];
for (const migrationName of expectedMigrations) {
  const sql = await readFile(
    join(migrationsDirectory, migrationName, 'migration.sql'),
    'utf8',
  );
  roleTransitions.push({
    migration_name: migrationName,
    set_role_count: (sql.match(/\bSET ROLE\b/gi) ?? []).length,
    reset_role_count: (sql.match(/\bRESET ROLE\b/gi) ?? []).length,
  });
}
const unbalancedRoleTransitions = roleTransitions.filter(
  ({ set_role_count, reset_role_count }) => set_role_count !== reset_role_count,
);
if (unbalancedRoleTransitions.length > 0) {
  throw new Error(
    `Migration role transition verification failed: ${JSON.stringify(unbalancedRoleTransitions)}`,
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const currentUser = await pool.query<{ current_user: string }>(
    'SELECT current_user',
  );
  if (currentUser.rows[0]?.current_user !== 'cfi_migrator') {
    throw new Error(
      `Migration verification must run as cfi_migrator; got ${currentUser.rows[0]?.current_user ?? 'unknown'}.`,
    );
  }

  const migrationHistory = await pool.query<MigrationRow>(
    `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
       FROM public._prisma_migrations
      ORDER BY started_at, migration_name`,
  );
  const actualNames = migrationHistory.rows.map(
    ({ migration_name }) => migration_name,
  );
  const counts = new Map<string, number>();
  for (const migrationName of actualNames) {
    counts.set(migrationName, (counts.get(migrationName) ?? 0) + 1);
  }
  const duplicateMigrations = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([migrationName]) => migrationName);
  const missingMigrations = expectedMigrations.filter(
    (migrationName) => !counts.has(migrationName),
  );
  const unexpectedMigrations = actualNames.filter(
    (migrationName) => !expectedMigrations.includes(migrationName),
  );
  const incompleteMigrations = migrationHistory.rows
    .filter(
      ({ finished_at, rolled_back_at }) =>
        finished_at === null || rolled_back_at !== null,
    )
    .map(({ migration_name }) => migration_name);

  if (
    missingMigrations.length > 0 ||
    unexpectedMigrations.length > 0 ||
    duplicateMigrations.length > 0 ||
    incompleteMigrations.length > 0 ||
    migrationHistory.rows.length !== expectedMigrations.length
  ) {
    throw new Error(
      `Migration history verification failed: ${JSON.stringify({
        expectedCount: expectedMigrations.length,
        actualCount: migrationHistory.rows.length,
        missingMigrations,
        unexpectedMigrations,
        duplicateMigrations,
        incompleteMigrations,
      })}`,
    );
  }

  const protectedTables = await pool.query<ProtectedTableRow>(
    `SELECT c.relname AS table_name,
            c.relowner::regrole::text AS owner,
            c.relrowsecurity AS row_security,
            c.relforcerowsecurity AS force_row_security
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'tenants',
          'users',
          'identity_links',
          'accounts',
          'audit_records',
          'categories',
          'transactions',
          'category_rules'
        )
      ORDER BY c.relname`,
  );
  const unsafeTables = protectedTables.rows.filter(
    ({ owner, row_security, force_row_security }) =>
      owner !== 'cfi_owner' || !row_security || !force_row_security,
  );
  if (protectedTables.rows.length !== 8 || unsafeTables.length > 0) {
    throw new Error(
      `Protected table verification failed: ${JSON.stringify({
        expectedCount: 8,
        actualCount: protectedTables.rows.length,
        unsafeTables,
      })}`,
    );
  }

  const roles = await pool.query<RoleRow>(
    `SELECT rolname, rolsuper, rolbypassrls
       FROM pg_roles
      WHERE rolname IN ('cfi_runtime', 'cfi_test')
      ORDER BY rolname`,
  );
  const unsafeRoles = roles.rows.filter(
    ({ rolsuper, rolbypassrls }) => rolsuper || rolbypassrls,
  );
  if (roles.rows.length !== 2 || unsafeRoles.length > 0) {
    throw new Error(
      `Runtime role verification failed: ${JSON.stringify({
        expectedRoles: ['cfi_runtime', 'cfi_test'],
        actualRoles: roles.rows,
        unsafeRoles,
      })}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        databaseUser: currentUser.rows[0]?.current_user,
        migrationCount: migrationHistory.rows.length,
        migrations: migrationHistory.rows.map(
          ({ migration_name, applied_steps_count }) => ({
            migration_name,
            applied_steps_count,
          }),
        ),
        roleTransitions,
        protectedTables: protectedTables.rows,
        roles: roles.rows,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
