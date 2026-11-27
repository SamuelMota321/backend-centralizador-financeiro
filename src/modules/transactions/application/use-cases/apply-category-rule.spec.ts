import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuditRecord } from '../../../audit/application/audit-record.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { CategoryRuleSnapshot } from '../../domain/category-rule.js';
import type { CategorySnapshot } from '../../domain/category.js';
import type { TransactionSnapshot } from '../../domain/transaction.js';
import type {
  TransactionPersistenceScope,
  TransactionsRepository,
} from '../ports/transactions.repository.port.js';
import { InvalidTransactionRequest } from '../transactions.errors.js';
import { ApplyCategoryRule } from './apply-category-rule.js';

const context: TenantContext = { tenantId: randomUUID(), userId: randomUUID() };
const NOW = '2026-11-20T10:00:00.000Z';
const PERIOD = { from: '2026-08-01', to: '2026-09-30' };

function transaction(description: string, index = 0): TransactionSnapshot {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    tenantId: context.tenantId,
    accountId: randomUUID(),
    externalIdentityKey: null,
    type: 'expense',
    amount: '12.00',
    occurredOn: '2026-08-15',
    description,
    status: 'posted',
    transferId: null,
    transferSide: null,
    categoryId: null,
    categorizationStatus: 'unclassified',
    categorizationSource: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function rule(overrides: Partial<CategoryRuleSnapshot> = {}): CategoryRuleSnapshot {
  return {
    id: randomUUID(),
    tenantId: context.tenantId,
    categoryId: randomUUID(),
    conditionField: 'description',
    conditionOperator: 'contains',
    conditionValue: 'burguer',
    priority: 10,
    status: 'active',
    removedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function category(id: string, status: 'active' | 'archived' = 'active'): CategorySnapshot {
  return {
    id,
    tenantId: context.tenantId,
    name: 'Alimentação',
    source: 'user',
    status,
    archivedAt: status === 'archived' ? NOW : null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function build(options: {
  rule: CategoryRuleSnapshot | null;
  category?: CategorySnapshot | null;
  pages: TransactionSnapshot[][];
}) {
  const pages = [...options.pages];
  const findUnclassifiedInPeriod = vi.fn(() => Promise.resolve(pages.shift() ?? []));
  const categorizeByRule = vi.fn((ids: readonly string[]) => Promise.resolve(ids.length));
  const audited: AuditRecord[] = [];
  const scope = {
    transactions: { findUnclassifiedInPeriod, categorizeByRule },
    categoryRules: { findById: () => Promise.resolve(options.rule) },
    categories: {
      findById: () =>
        Promise.resolve(
          options.category === undefined
            ? category(options.rule?.categoryId ?? randomUUID())
            : options.category,
        ),
    },
    audit: {
      write: (record: AuditRecord) => {
        audited.push(record);
        return Promise.resolve();
      },
    },
  } as unknown as TransactionPersistenceScope;
  const repository: TransactionsRepository = {
    withTenant: (_context, operation) => operation(scope),
  };
  return { useCase: new ApplyCategoryRule(repository), findUnclassifiedInPeriod, categorizeByRule, audited };
}

describe('ApplyCategoryRule', () => {
  it('categorizes only the lines the rule matches and audits each one', async () => {
    const lines = [transaction('Burguer King', 1), transaction('Padaria', 2), transaction('BURGUER do Zé', 3)];
    const target = rule();
    const { useCase, categorizeByRule, audited } = build({ rule: target, pages: [lines] });

    const result = await useCase.execute(context, target.id, PERIOD);

    expect(result).toEqual({
      ruleId: target.id,
      ...PERIOD,
      examined: 3,
      categorized: 2,
      truncated: false,
    });
    expect(categorizeByRule).toHaveBeenCalledWith([lines[0]!.id, lines[2]!.id], target.categoryId);
    expect(audited.map((record) => record.props.resourceId)).toEqual([lines[0]!.id, lines[2]!.id]);
  });

  it('walks every chunk until the period is exhausted', async () => {
    const full = Array.from({ length: 100 }, (_, index) => transaction('Burguer', index + 1));
    const rest = [transaction('Burguer', 500)];
    const target = rule();
    const { useCase, findUnclassifiedInPeriod } = build({ rule: target, pages: [full, rest] });

    const result = await useCase.execute(context, target.id, PERIOD);

    expect(result.examined).toBe(101);
    expect(result.categorized).toBe(101);
    expect(findUnclassifiedInPeriod).toHaveBeenCalledTimes(2);
    expect(findUnclassifiedInPeriod).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterId: full.at(-1)!.id }),
    );
  });

  it('does nothing and audits nothing when no line matches', async () => {
    const target = rule();
    const { useCase, audited } = build({ rule: target, pages: [[transaction('Padaria', 1)]] });

    await expect(useCase.execute(context, target.id, PERIOD)).resolves.toMatchObject({
      examined: 1,
      categorized: 0,
    });
    expect(audited).toHaveLength(0);
  });

  it.each([
    ['inactive', rule({ status: 'inactive' })],
    ['removed', rule({ status: 'removed', removedAt: NOW })],
  ])('refuses an %s rule without touching transactions', async (_label, target) => {
    const { useCase, findUnclassifiedInPeriod } = build({ rule: target, pages: [] });

    await expect(useCase.execute(context, target.id, PERIOD)).rejects.toThrow();
    expect(findUnclassifiedInPeriod).not.toHaveBeenCalled();
  });

  it('refuses a missing rule and an archived category', async () => {
    await expect(
      build({ rule: null, pages: [] }).useCase.execute(context, randomUUID(), PERIOD),
    ).rejects.toThrow();
    const target = rule();
    await expect(
      build({ rule: target, category: category(target.categoryId, 'archived'), pages: [] }).useCase.execute(
        context,
        target.id,
        PERIOD,
      ),
    ).rejects.toThrow();
  });

  it.each([
    ['inverted', { from: '2026-09-30', to: '2026-08-01' }],
    ['not a date', { from: '2026-02-30', to: '2026-03-01' }],
    ['too long', { from: '2020-01-01', to: '2026-09-30' }],
  ])('rejects a %s period', async (_label, period) => {
    const target = rule();
    const { useCase } = build({ rule: target, pages: [] });

    await expect(useCase.execute(context, target.id, period)).rejects.toBeInstanceOf(
      InvalidTransactionRequest,
    );
  });
});
