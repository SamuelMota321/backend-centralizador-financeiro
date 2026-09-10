import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './environment.schema.js';

describe('environment configuration', () => {
  it('accepts a runtime PostgreSQL URL without migration credentials', () => {
    const environment = validateEnvironment({
      DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
    });
    expect(environment.PORT).toBe(3000);
  });

  it('rejects non-PostgreSQL URLs', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'https://example.com' }),
    ).toThrow();
  });
});
