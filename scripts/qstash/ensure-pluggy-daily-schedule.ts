import 'dotenv/config';
import { Client } from '@upstash/qstash';

const token = process.env.QSTASH_TOKEN;
const baseUrl = process.env.QSTASH_URL;
const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL;
if (
  !token ||
  !baseUrl ||
  !publicApiBaseUrl ||
  new URL(publicApiBaseUrl).protocol !== 'https:'
) {
  throw new Error(
    'QSTASH_TOKEN, QSTASH_URL and HTTPS PUBLIC_API_BASE_URL are required.',
  );
}

const scheduleId = 'cfi-pluggy-daily-sync';
const destination = new URL(
  '/api/v1/internal/jobs/pluggy-daily-sync',
  publicApiBaseUrl,
).toString();
const client = new Client({ token, baseUrl });
await client.schedules.create({
  destination,
  scheduleId,
  cron: 'CRON_TZ=America/Sao_Paulo 0 12 * * *',
  retries: 3,
  body: '{}',
  headers: { 'Content-Type': 'application/json' },
});
console.log(`QStash schedule ${scheduleId} points to ${destination}.`);
