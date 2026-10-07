import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
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
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import type { TransactionAccountOwnership } from '../ports/transaction-account-ownership.port.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';
import type { TransactionAccountImportEligibilityReader } from '../ports/transaction-account-import-eligibility.port.js';
import {
  CategoryArchived,
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
  TransactionsTenantMismatch,
} from '../transactions.errors.js';
import { CreateCategory } from './create-category.js';
import { CreateCategoryRule } from './create-category-rule.js';
import { GetTransaction } from './get-transaction.js';
import { ImportOfxTransaction } from './import-ofx-transaction.js';
import { PersistTransaction } from './persist-transaction.js';
import { UpdateCategoryRule } from './update-category-rule.js';

const context: TenantContext = {
  tenantId: randomUUID(),
  userId: randomUUID(),
};

const transactionSnapshot: TransactionSnapshot = {
  id: randomUUID(),
  tenantId: context.tenantId,
  accountId: randomUUID(),
  externalIdentityKey: null,
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
  const createTransactionIfAbsent = vi.fn((_transaction: Transaction) =>
    Promise.resolve<TransactionSnapshot | null>(transactionSnapshot),
  );
  const findTransactionById = vi.fn(() => Promise.resolve(transactionSnapshot));
  const findTransactionsByIds = vi.fn(() =>
    Promise.resolve([transactionSnapshot]),
  );
  const transactions: TenantTransactionsRepository = {
    create: createTransaction,
    createIfExternalIdentityAbsent: createTransactionIfAbsent,
    findById: findTransactionById,
    findByIds: findTransactionsByIds,
    findByIdForUpdate: findTransactionById,
    count: vi.fn(() => Promise.resolve(1)),
    findPage: vi.fn(() => Promise.resolve([transactionSnapshot])),
    update: vi.fn(() => Promise.resolve(transactionSnapshot)),
  };
  const createCategory = vi.fn((category: Category) => {
    capturedCategory = category;
    return Promise.resolve(categorySnapshot);
  });
  const findCategoryById = vi.fn(() => Promise.resolve(categorySnapshot));
  const categories: TenantCategoriesRepository = {
    create: createCategory,
    findById: findCategoryById,
    findByIdForUpdate: findCategoryById,
    count: vi.fn(() => Promise.resolve(1)),
    findPage: vi.fn(() => Promise.resolve([categorySnapshot])),
    update: vi.fn(() => Promise.resolve(categorySnapshot)),
  };
  const createCategoryRule = vi.fn(() => Promise.resolve(categoryRuleSnapshot));
  const findCategoryRuleById = vi.fn(() =>
    Promise.resolve(categoryRuleSnapshot),
  );
  const categoryRules: TenantCategoryRulesRepository = {
    create: createCategoryRule,
    findById: findCategoryRuleById,
    findByIdForUpdate: findCategoryRuleById,
    count: vi.fn(() => Promise.resolve(1)),
    findPage: vi.fn(() => Promise.resolve([categoryRuleSnapshot])),
    findActiveForEvaluation: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() => Promise.resolve(categoryRuleSnapshot)),
  };
  const idempotency: TenantIdempotencyRepository = {
    find: vi.fn(() => Promise.resolve(null)),
    claim: vi.fn(() =>
      Promise.reject(new Error('Idempotency is not used by this fixture.')),
    ),
    complete: vi.fn(() => Promise.resolve()),
  };
  const auditWrite = vi.fn(() => Promise.resolve());
  const scope: TransactionPersistenceScope = {
    transactions,
    categories,
    categoryRules,
    idempotency,
    audit: { write: auditWrite } satisfies AuditWriter,
  };
  const withTenant: TransactionsRepository['withTenant'] = async <Result>(
    _tenantContext: TenantContext,
    operation: (value: TransactionPersistenceScope) => Promise<Result>,
  ) => operation(scope);
  const repository: TransactionsRepository = { withTenant };
  const unitOfWork: TransactionsUnitOfWork = { run: withTenant };
  return {
    repository,
    unitOfWork,
    scope,
    auditWrite,
    spies: {
      createTransaction,
      createTransactionIfAbsent,
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
  it('imports OFX rows through the active account and atomic dedupe boundary', async () => {
    const { unitOfWork, auditWrite, spies } = createRepository();
    const accountState: TransactionAccountImportEligibilityReader = {
      getOwnedImportAvailability: vi.fn<
        TransactionAccountImportEligibilityReader['getOwnedImportAvailability']
      >(() => Promise.resolve('active_local')),
    };

    const result = await new ImportOfxTransaction(
      unitOfWork,
      accountState,
    ).execute(context, {
      accountId: transactionSnapshot.accountId,
      type: 'expense',
      amount: '10.50',
      occurredOn: '2026-09-20',
      description: 'Mercado',
      externalId: 'bank-fitid-1',
    });

    expect(result).toEqual({
      disposition: 'imported',
      transactionId: transactionSnapshot.id,
    });
    expect(spies.createTransactionIfAbsent).toHaveBeenCalledOnce();
    expect(
      spies.createTransactionIfAbsent.mock.calls[0]?.[0].props
        .externalIdentityKey,
    ).toMatch(/^[0-9a-f]{64}$/u);
    expect(auditWrite).toHaveBeenCalledOnce();
  });

  it('reports a concurrent duplicate without a second audit write', async () => {
    const { unitOfWork, auditWrite, spies } = createRepository();
    spies.createTransactionIfAbsent.mockResolvedValueOnce(null);
    const accountState: TransactionAccountImportEligibilityReader = {
      getOwnedImportAvailability: vi.fn<
        TransactionAccountImportEligibilityReader['getOwnedImportAvailability']
      >(() => Promise.resolve('active_local')),
    };

    await expect(
      new ImportOfxTransaction(unitOfWork, accountState).execute(context, {
        accountId: transactionSnapshot.accountId,
        type: 'expense',
        amount: '10.50',
        occurredOn: '2026-09-20',
        description: 'Mercado',
        externalId: null,
      }),
    ).resolves.toEqual({ disposition: 'duplicate' });
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it('uses the normalized date, signed amount, and description for fallback identity', async () => {
    const { unitOfWork, spies } = createRepository();
    const identityKeys: Array<string | null> = [];
    spies.createTransactionIfAbsent.mockImplementation((transaction) => {
      identityKeys.push(transaction.props.externalIdentityKey);
      return Promise.resolve(transactionSnapshot);
    });
    const accountState: TransactionAccountImportEligibilityReader = {
      getOwnedImportAvailability: vi.fn<
        TransactionAccountImportEligibilityReader['getOwnedImportAvailability']
      >(() => Promise.resolve('active_local')),
    };
    const importer = new ImportOfxTransaction(unitOfWork, accountState);

    await importer.execute(context, {
      accountId: transactionSnapshot.accountId,
      type: 'expense',
      amount: '10.5',
      occurredOn: '2026-09-20',
      description: ' Market\n purchase ',
      externalId: null,
    });
    await importer.execute(context, {
      accountId: transactionSnapshot.accountId,
      type: 'expense',
      amount: '10.50',
      occurredOn: '2026-09-20',
      description: 'Market purchase',
      externalId: null,
    });

    expect(identityKeys[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(identityKeys[1]).toBe(identityKeys[0]);
  });

  it('rejects a connected account before transaction persistence', async () => {
    const { unitOfWork, spies } = createRepository();
    const accountState: TransactionAccountImportEligibilityReader = {
      getOwnedImportAvailability: vi.fn<
        TransactionAccountImportEligibilityReader['getOwnedImportAvailability']
      >(() => Promise.resolve('active_connected')),
    };

    await expect(
      new ImportOfxTransaction(unitOfWork, accountState).execute(context, {
        accountId: transactionSnapshot.accountId,
        type: 'expense',
        amount: '10.50',
        occurredOn: '2026-09-20',
        description: 'Mercado',
        externalId: 'bank-fitid-1',
      }),
    ).rejects.toBeInstanceOf(InvalidTransactionRequest);
    expect(spies.createTransactionIfAbsent).not.toHaveBeenCalled();
  });

  it('persists only a transaction owned by the authenticated context', async () => {
    const { unitOfWork, auditWrite, spies } = createRepository();
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
      unitOfWork,
      accountOwnership,
    ).execute(context, transaction);

    expect(result).not.toHaveProperty('tenantId');
    expect(result.id).toBe(transactionSnapshot.id);
    expect(spies.createTransaction).toHaveBeenCalledWith(transaction);
    expect(auditWrite).toHaveBeenCalledOnce();
  });

  it('rejects an aggregate owned by another tenant before persistence', async () => {
    const { unitOfWork, spies } = createRepository();
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
      new PersistTransaction(unitOfWork, accountOwnership).execute(
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

  it('uses account ownership errors consistently for rule creation', async () => {
    const { repository } = createRepository();
    const accountState: TransactionAccountStateReader = {
      getOwnedState: vi
        .fn<TransactionAccountStateReader['getOwnedState']>()
        .mockResolvedValueOnce('missing')
        .mockResolvedValueOnce('archived'),
    };
    const input = {
      categoryId: categorySnapshot.id,
      conditionField: 'accountId',
      conditionOperator: 'equals',
      conditionValue: randomUUID(),
      priority: 10,
    };

    await expect(
      new CreateCategoryRule(repository, accountState).execute(context, input),
    ).rejects.toBeInstanceOf(TransactionAccountNotFound);
    await expect(
      new CreateCategoryRule(repository, accountState).execute(context, input),
    ).rejects.toBeInstanceOf(TransactionAccountArchived);
  });

  it('rejects archived accounts when an existing rule is changed to accountId', async () => {
    const { repository, unitOfWork } = createRepository();
    const accountState: TransactionAccountStateReader = {
      getOwnedState: vi
        .fn<TransactionAccountStateReader['getOwnedState']>()
        .mockResolvedValue('archived'),
    };

    await expect(
      new UpdateCategoryRule(repository, unitOfWork, accountState).execute(
        context,
        categoryRuleSnapshot.id,
        randomUUID(),
        {
          conditionField: 'accountId',
          conditionOperator: 'equals',
          conditionValue: randomUUID(),
        },
      ),
    ).rejects.toBeInstanceOf(TransactionAccountArchived);
  });

  it('hides a transaction that the scoped repository cannot return', async () => {
    const { repository, scope } = createRepository();
    scope.transactions.findById = vi.fn(() => Promise.resolve(null));

    await expect(
      new GetTransaction(repository).execute(context, randomUUID()),
    ).rejects.toMatchObject({ name: 'TransactionNotFound' });
  });
});
