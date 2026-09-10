import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const offlineOnlyUrl = 'postgresql://invalid:invalid@127.0.0.1:1/invalid';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? offlineOnlyUrl,
  },
});
