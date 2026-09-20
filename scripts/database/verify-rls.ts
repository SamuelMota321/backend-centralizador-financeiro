import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rawDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!rawDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for RLS verification.');
}

const databaseUrl = new URL(rawDatabaseUrl);
databaseUrl.searchParams.delete('schema');

const psql = spawn(
  'psql',
  [
    databaseUrl.toString(),
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    fileURLToPath(new URL('./verify-rls.sql', import.meta.url)),
  ],
  { stdio: 'inherit', windowsHide: true },
);

const exitCode = await new Promise<number>((resolve, reject) => {
  psql.once('error', reject);
  psql.once('close', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
}
