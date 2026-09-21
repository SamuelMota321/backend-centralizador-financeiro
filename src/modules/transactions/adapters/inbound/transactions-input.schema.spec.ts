import { describe, expect, it } from 'vitest';
import {
  idempotencyKeySchema,
  transactionInputSchema,
  transferInputSchema,
} from './transactions-input.schema.js';

describe('transactions input schemas', () => {
  it('requires the approved movement fields and rejects unknown fields', () => {
    expect(() =>
      transactionInputSchema.parse({
        accountId: 'not-an-id',
        type: 'income',
        amount: '10.00',
        occurredOn: '2026-09-20',
      }),
    ).toThrow();
    expect(() =>
      transactionInputSchema.parse({
        accountId: '264aa078-983d-4c39-aae4-dda44b495970',
        type: 'income',
        amount: '10.00',
        occurredOn: '2026-09-20',
        tenantId: 'client-controlled',
      }),
    ).toThrow();
  });

  it('accepts positive BRL amounts with two decimals and rejects zero', () => {
    const base = {
      accountId: '264aa078-983d-4c39-aae4-dda44b495970',
      type: 'expense' as const,
      occurredOn: '2026-09-20',
    };
    expect(
      transactionInputSchema.parse({ ...base, amount: '0.01' }),
    ).toMatchObject({
      amount: '0.01',
    });
    expect(() =>
      transactionInputSchema.parse({ ...base, amount: '0.00' }),
    ).toThrow();
    expect(() =>
      transactionInputSchema.parse({ ...base, amount: '-1.00' }),
    ).toThrow();
  });

  it('requires two account ids and a non-empty idempotency key for transfers', () => {
    expect(() =>
      transferInputSchema.parse({
        fromAccountId: '264aa078-983d-4c39-aae4-dda44b495970',
        toAccountId: '364aa078-983d-4c39-aae4-dda44b495970',
        amount: '10.00',
        occurredOn: '2026-09-20',
      }),
    ).not.toThrow();
    expect(() => idempotencyKeySchema.parse('')).toThrow();
    expect(() => idempotencyKeySchema.parse(undefined)).toThrow();
  });
});
