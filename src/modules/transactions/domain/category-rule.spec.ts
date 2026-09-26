import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CategoryRule } from './category-rule.js';
import { Transaction } from './transaction.js';
import {
  CategoryRuleRemoved,
  InvalidCategoryRule,
} from './transactions.errors.js';

const base = {
  tenantId: randomUUID(),
  categoryId: randomUUID(),
};

describe('CategoryRule', () => {
  it('creates an active rule with the approved condition operators', () => {
    const rule = CategoryRule.create({
      ...base,
      conditionField: 'description',
      conditionOperator: 'contains',
      conditionValue: '  mercado  ',
      priority: 10,
    });

    expect(rule.props).toMatchObject({
      conditionValue: 'mercado',
      status: 'active',
      removedAt: null,
      priority: 10,
    });
  });

  it('enforces the PostgreSQL integer priority ceiling', () => {
    expect(() =>
      CategoryRule.create({
        ...base,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'mercado',
        priority: 2_147_483_647,
      }),
    ).not.toThrow();
    expect(() =>
      CategoryRule.create({
        ...base,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'mercado',
        priority: 2_147_483_648,
      }),
    ).toThrow(InvalidCategoryRule);
  });

  it('only permits equals for type and accountId conditions', () => {
    expect(() =>
      CategoryRule.create({
        ...base,
        conditionField: 'type',
        conditionOperator: 'contains',
        conditionValue: 'income',
        priority: 0,
      }),
    ).toThrow(InvalidCategoryRule);
  });

  it('supports active, inactive and removed lifecycle states', () => {
    const rule = CategoryRule.create({
      ...base,
      conditionField: 'accountId',
      conditionOperator: 'equals',
      conditionValue: randomUUID(),
      priority: 0,
    });
    const inactive = rule.deactivate('2026-09-20T10:00:00.000Z');
    const active = inactive.activate('2026-09-20T10:01:00.000Z');
    const removed = active.remove('2026-09-20T10:02:00.000Z');

    expect(inactive.props.status).toBe('inactive');
    expect(active.props.status).toBe('active');
    expect(removed.props.status).toBe('removed');
    expect(removed.props.removedAt).toBe('2026-09-20T10:02:00.000Z');
    expect(() => removed.activate('2026-09-20T10:03:00.000Z')).toThrow(
      CategoryRuleRemoved,
    );
  });

  it('matches normalized descriptions case-insensitively', () => {
    const rule = CategoryRule.create({
      ...base,
      conditionField: 'description',
      conditionOperator: 'contains',
      conditionValue: '  mercado   central ',
      priority: 5,
    });
    const transaction = Transaction.createManual({
      tenantId: base.tenantId,
      accountId: randomUUID(),
      type: 'expense',
      amount: '12.00',
      occurredOn: '2026-09-20',
      description: 'Compra no MERCADO CENTRAL',
    });

    expect(rule.matches(transaction)).toBe(true);
    expect(
      rule.deactivate('2026-09-20T10:00:00.000Z').matches(transaction),
    ).toBe(false);
  });

  it('matches type and account conditions with their restricted operator', () => {
    const accountId = randomUUID();
    const transaction = Transaction.createManual({
      tenantId: base.tenantId,
      accountId,
      type: 'income',
      amount: '20.00',
      occurredOn: '2026-09-20',
    });
    const typeRule = CategoryRule.create({
      ...base,
      conditionField: 'type',
      conditionOperator: 'equals',
      conditionValue: 'INCOME',
      priority: 1,
    });
    const accountRule = CategoryRule.create({
      ...base,
      conditionField: 'accountId',
      conditionOperator: 'equals',
      conditionValue: accountId.toUpperCase(),
      priority: 1,
    });

    expect(typeRule.matches(transaction)).toBe(true);
    expect(accountRule.matches(transaction)).toBe(true);
  });

  it('edits conditions while preserving lifecycle and rejects removed rules', () => {
    const rule = CategoryRule.create({
      ...base,
      conditionField: 'description',
      conditionOperator: 'equals',
      conditionValue: 'mercado',
      priority: 1,
    });
    const snapshot = {
      id: randomUUID(),
      ...rule.props,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    const reconstituted = CategoryRule.reconstitute(snapshot);
    const updated = reconstituted.update(
      { conditionOperator: 'starts_with', conditionValue: 'merc' },
      '2026-09-20T10:01:00.000Z',
    );

    expect(updated.props).toMatchObject({
      conditionOperator: 'starts_with',
      conditionValue: 'merc',
      status: 'active',
    });
    expect(() =>
      updated
        .remove('2026-09-20T10:02:00.000Z')
        .update({ priority: 2 }, '2026-09-20T10:03:00.000Z'),
    ).toThrow(CategoryRuleRemoved);
  });
});
