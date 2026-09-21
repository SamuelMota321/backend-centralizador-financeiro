import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { CategoryRuleSnapshot } from '../../domain/category-rule.js';
import type { Category, CategorySnapshot } from '../../domain/category.js';
import { Transaction } from '../../domain/transaction.js';
import type { TransactionSnapshot } from '../../domain/transaction.js';
import type { TenantIdempotencyRepository } from '../ports/idempotency.repository.port.js';
import type {
  TenantCategoriesRepository,
  TenantCategoryRulesRepository,
  TenantTransactionsRepository,
  TransactionPersistenceScope,
  TransactionsRepository,
} from '../ports/transactions.repository.port.js';
import type { TransactionAccountOwnership } from '../ports/transaction-account-ownership.port.js';
import {
  CategoryArchived,
  TransactionsTenantMismatch,
} from '../transactions.errors.js';
import { CreateCategory } from './create-category.js';
import { CreateCategoryRule } from './create-category-rule.js';
import { GetTransaction } from './get-transaction.js';
import { PersistTransaction } from './persist-transaction.js';

const context: TenantContext = {
  tenantId: randomUUID(),
  userId: randomUUID(),
};

const transactionSnapshot: TransactionSnapshot = {
  id: randomUUID(),
  tenantId: context.tenantId,
  accountId: randomUUID(),
  type: 'income',
  amount: '10.50',
  occurredOn: '2026-09-20',
  description: 'Salário',
  status: 'posted',
  transferId: null,
  transferSide: null,
  categoryId: null,
  categorizationStatus: 'unclassified',
  categorizationSource: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

const categorySnapshot: CategorySnapshot = {
  id: randomUUID(),
  tenantId: context.tenantId,
  name: 'Mercado',
  source: 'user',
  status: 'active',
  archivedAt: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

const categoryRuleSnapshot: CategoryRuleSnapshot = {
  id: randomUUID(),
  tenantId: context.tenantId,
  categoryId: categorySnapshot.id,
  conditionField: 'description',
  conditionOperator: 'contains',
  conditionValue: 'mercado',
  priority: 10,
  status: 'active',
  removedAt: null,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

function createRepository() {
  let capturedCategory: Category | undefined;
  const createTransaction = vi.fn(() => Promise.resolve(transactionSnapshot));
  const findTransactionById = vi.fn(() => Promise.resolve(transactionSnapshot));
  const findTransactionsByIds = vi.fn(() =>
    Promise.resolve([transactionSnapshot]),
  );
  const transactions: TenantTransactionsRepository = {
    create: createTransaction,
    findById: findTransactionById,
    findByIds: findTransactionsByIds,
  };
  const createCategory = vi.fn((category: Category) => {
    capturedCategory = category;
    return Promise.resolve(categorySnapshot);
  });
  const findCategoryById = vi.fn(() => Promise.resolve(categorySnapshot));
  const categories: TenantCategoriesRepository = {
    create: createCategory,
    findById: findCategoryById,
  };
  const createCategoryRule = vi.fn(() => Promise.resolve(categoryRuleSnapshot));
  const findCategoryRuleById = vi.fn(() =>
    Promise.resolve(categoryRuleSnapshot),
  );
  const categoryRules: TenantCategoryRulesRepository = {
    create: createCategoryRule,
    findById: findCategoryRuleById,
  };
  const idempotency: TenantIdempotencyRepository = {
    find: vi.fn(() => Promise.resolve(null)),
    claim: vi.fn(() =>
      Promise.reject(new Error('Idempotency is not used by this fixture.')),
    ),
    complete: vi.fn(() => Promise.resolve()),
  };
  const scope: TransactionPersistenceScope = {
    transactions,
    categories,
    categoryRules,
    idempotency,
  };
  const withTenant: TransactionsRepository['withTenant'] = async <Result>(
    _tenantContext: TenantContext,
    operation: (value: TransactionPersistenceScope) => Promise<Result>,
  ) => operation(scope);
  const repository: TransactionsRepository = { withTenant };
  return {
    repository,
    scope,
    spies: {
      createTransaction,
      findTransactionById,
      findTransactionsByIds,
      createCategory,
      findCategoryById,
      createCategoryRule,
      findCategoryRuleById,
      capturedCategory: () => capturedCategory,
    },
  };
}

describe('Transactions application boundaries', () => {
  it('persists only a transaction owned by the authenticated context', async () => {
    const { repository, spies } = createRepository();
    const accountOwnership: TransactionAccountOwnership = {
      isActiveOwned: vi.fn(() => Promise.resolve(true)),
    };
    const transaction = Transaction.createManual({
      tenantId: context.tenantId,
      accountId: transactionSnapshot.accountId,
      type: 'income',
      amount: '10.50',
      occurredOn: '2026-09-20',
    });

    const result = await new PersistTransaction(
      repository,
      accountOwnership,
    ).execute(context, transaction);

    expect(result).not.toHaveProperty('tenantId');
    expect(result.id).toBe(transactionSnapshot.id);
    expect(spies.createTransaction).toHaveBeenCalledWith(transaction);
  });

  it('rejects an aggregate owned by another tenant before persistence', async () => {
    const { repository, spies } = createRepository();
    const accountOwnership: TransactionAccountOwnership = {
      isActiveOwned: vi.fn(() => Promise.resolve(true)),
    };
    const transaction = Transaction.createManual({
      tenantId: randomUUID(),
      accountId: randomUUID(),
      type: 'expense',
      amount: '1.00',
      occurredOn: '2026-09-20',
    });

    await expect(
      new PersistTransaction(repository, accountOwnership).execute(
        context,
        transaction,
      ),
    ).rejects.toBeInstanceOf(TransactionsTenantMismatch);
    expect(spies.createTransaction).not.toHaveBeenCalled();
  });

  it('creates a category using the tenant from context', async () => {
    const { repository, spies } = createRepository();
    const result = await new CreateCategory(repository).execute(context, {
      name: '  Mercado  ',
    });

    expect(result).toMatchObject({
      id: categorySnapshot.id,
      name: categorySnapshot.name,
      status: 'active',
    });
    expect(spies.capturedCategory()?.props.tenantId).toBe(context.tenantId);
  });

  it('does not create a rule for an archived category', async () => {
    const { repository, scope, spies } = createRepository();
    const archivedCategory: CategorySnapshot = {
      ...categorySnapshot,
      status: 'archived',
      archivedAt: '2026-09-20T10:01:00.000Z',
    };
    const findById = vi.fn(() => Promise.resolve(archivedCategory));
    scope.categories.findById = findById;

    await expect(
      new CreateCategoryRule(repository).execute(context, {
        categoryId: archivedCategory.id,
        conditionField: 'description',
        conditionOperator: 'contains',
        conditionValue: 'mercado',
        priority: 10,
      }),
    ).rejects.toBeInstanceOf(CategoryArchived);
    expect(spies.createCategoryRule).not.toHaveBeenCalled();
  });

  it('hides a transaction that the scoped repository cannot return', async () => {
    const { repository, scope } = createRepository();
    scope.transactions.findById = vi.fn(() => Promise.resolve(null));

    await expect(
      new GetTransaction(repository).execute(context, randomUUID()),
    ).rejects.toMatchObject({ name: 'TransactionNotFound' });
  });
});
