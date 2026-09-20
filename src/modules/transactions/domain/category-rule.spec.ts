import { describe, expect, it } from 'vitest';
import { CategoryRule } from './category-rule.js';
import {
  CategoryRuleRemoved,
  InvalidCategoryRule,
} from './transactions.errors.js';

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  categoryId: '22222222-2222-4222-8222-222222222222',
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
      conditionValue: '33333333-3333-4333-8333-333333333333',
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
});
