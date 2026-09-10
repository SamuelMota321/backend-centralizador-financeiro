import { describe, expect, it } from 'vitest';
import { manualAccountInputSchema } from './account-input.schema.js';

describe('manualAccountInputSchema', () => {
  it('normalizes boundary input', () => {
    const result = manualAccountInputSchema.parse({
      name: '  Conta   Principal ',
      type: 'checking',
      institutionName: '',
      initialBalance: '10.50',
      initialBalanceAsOf: '2000-01-01',
    });
    expect(result.name).toBe('Conta Principal');
    expect(result.institutionName).toBeNull();
    expect(result.confirmPossibleDuplicate).toBe(false);
  });

  it('rejects unknown fields and invalid precision', () => {
    const result = manualAccountInputSchema.safeParse({
      name: 'Conta',
      type: 'checking',
      initialBalance: '10.999',
      initialBalanceAsOf: '2000-01-01',
      tenantId: 'client-controlled',
    });
    expect(result.success).toBe(false);
  });

  it('accepts explicit duplicate confirmation', () => {
    const result = manualAccountInputSchema.parse({
      name: 'Conta Principal',
      type: 'checking',
      initialBalance: '10.50',
      initialBalanceAsOf: '2000-01-01',
      confirmPossibleDuplicate: true,
    });
    expect(result.confirmPossibleDuplicate).toBe(true);
  });
});
