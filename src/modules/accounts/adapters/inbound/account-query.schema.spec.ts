import { describe, expect, it } from 'vitest';
import { accountQuerySchema } from './account-query.schema.js';

describe('accountQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(accountQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces valid query-string values', () => {
    expect(accountQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
  });

  it('rejects invalid limits and unknown fields', () => {
    expect(accountQuerySchema.safeParse({ pageSize: '101' }).success).toBe(
      false,
    );
    expect(accountQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});
