import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.schema.js';

describe('environment configuration', () => {
  it('accepts a runtime PostgreSQL URL without migration credentials', () => {
    const environment = validateEnvironment({
      DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
      AUTH0_ISSUER_BASE_URL: 'https://tenant.example.com/',
      AUTH0_AUDIENCE: 'https://api.example.com',
    });
    expect(environment.PORT).toBe(3000);
  });

  it('rejects non-PostgreSQL URLs', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'https://example.com' }),
    ).toThrow();
  });

  it('requires Auth0 issuer and audience', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
      }),
    ).toThrow();
  });

  it('rejects a non-HTTPS Auth0 issuer', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
        AUTH0_ISSUER_BASE_URL: 'http://tenant.example.com/',
        AUTH0_AUDIENCE: 'https://api.example.com',
      }),
    ).toThrow();
  });

  it('requires all R2 settings when any R2 setting is provided', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
        AUTH0_ISSUER_BASE_URL: 'https://tenant.example.com/',
        AUTH0_AUDIENCE: 'https://api.example.com',
        R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      }),
    ).toThrow();
  });

  it('requires the complete Pluggy and QStash integration configuration', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
        AUTH0_ISSUER_BASE_URL: 'https://tenant.example.com/',
        AUTH0_AUDIENCE: 'https://api.example.com',
        PLUGGY_CLIENT_ID: 'fixture-client-id',
      }),
    ).toThrow();
  });
});
