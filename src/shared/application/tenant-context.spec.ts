import { describe, expect, it } from 'vitest';
import { assertTenantContext, InvalidTenantContext } from './tenant-context.js';

describe('TenantContext', () => {
  it('accepts canonical UUIDs', () => {
    expect(() =>
      assertTenantContext({
        tenantId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
      }),
    ).not.toThrow();
  });

  it('fails closed for malformed context', () => {
    expect(() =>
      assertTenantContext({ tenantId: '', userId: 'not-a-uuid' }),
    ).toThrow(InvalidTenantContext);
  });

  it.each([null, undefined, 42, {}, { tenantId: 42, userId: 'not-a-uuid' }])(
    'fails closed for untrusted context values: %s',
    (context) => {
      expect(() => assertTenantContext(context)).toThrow(InvalidTenantContext);
    },
  );
});
