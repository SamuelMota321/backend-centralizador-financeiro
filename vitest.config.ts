import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      AUTH0_ISSUER_BASE_URL: 'https://test-issuer.example.com/',
      AUTH0_AUDIENCE: 'https://test-api.example.com',
    },
    globals: false,
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
