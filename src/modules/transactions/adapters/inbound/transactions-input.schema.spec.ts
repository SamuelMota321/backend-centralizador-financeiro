import { describe, expect, it } from 'vitest';
import {
  categoryRuleInputSchema,
  categoryRuleUpdateInputSchema,
  idempotencyKeySchema,
  paginationQuerySchema,
  transactionCategoryInputSchema,
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

  it('accepts only explicit category correction outcomes', () => {
    expect(
      transactionCategoryInputSchema.parse({
        categoryId: '264aa078-983d-4c39-aae4-dda44b495970',
      }),
    ).toEqual({ categoryId: '264aa078-983d-4c39-aae4-dda44b495970' });
    expect(
      transactionCategoryInputSchema.parse({
        categorizationStatus: 'unrecognized',
      }),
    ).toEqual({ categorizationStatus: 'unrecognized' });
    expect(() =>
      transactionCategoryInputSchema.parse({ categorizationStatus: 'unclassified' }),
    ).toThrow();
  });

  it('rejects unsupported rule operators and empty updates', () => {
    expect(() =>
      categoryRuleInputSchema.parse({
        categoryId: '264aa078-983d-4c39-aae4-dda44b495970',
        conditionField: 'description',
        conditionOperator: 'regex',
        conditionValue: 'mercado',
        priority: 1,
      }),
    ).toThrow();
    expect(() => categoryRuleUpdateInputSchema.parse({})).toThrow();
  });

  it('applies the approved pagination defaults and bounds', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(() => paginationQuerySchema.parse({ pageSize: 101 })).toThrow();
  });
});
