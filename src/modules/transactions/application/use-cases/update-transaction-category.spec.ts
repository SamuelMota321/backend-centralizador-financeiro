import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuditRecord } from '../../../audit/application/audit-record.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { TenantIdempotencyRepository } from '../ports/idempotency.repository.port.js';
import type { CategorySnapshot, Category } from '../../domain/category.js';
import type { Transaction, TransactionSnapshot } from '../../domain/transaction.js';
import type {
  TenantCategoriesRepository,
  TenantCategoryRulesRepository,
  TenantTransactionsRepository,
  TransactionPersistenceScope,
  TransactionsRepository,
} from '../ports/transactions.repository.port.js';
import { CategoryNotFound } from '../transactions.errors.js';
import { UpdateTransactionCategory } from './update-transaction-category.js';

describe('UpdateTransactionCategory', () => {
  it('persists a same-tenant manual category and audit record', async () => {
    const context: TenantContext = {
      tenantId: randomUUID(),
      userId: randomUUID(),
    };
    const transaction: TransactionSnapshot = {
      id: randomUUID(),
      tenantId: context.tenantId,
      accountId: randomUUID(),
      type: 'expense',
      amount: '12.00',
      occurredOn: '2026-09-20',
      description: 'Mercado',
      status: 'posted',
      transferId: null,
      transferSide: null,
      categoryId: null,
      categorizationStatus: 'unclassified',
      categorizationSource: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    const category: CategorySnapshot = {
      id: randomUUID(),
      tenantId: context.tenantId,
      name: 'Mercado',
      source: 'user',
      status: 'active',
      archivedAt: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    };
    let audited: AuditRecord | undefined;
    const transactions = createTransactionsRepository(transaction);
    const categories = createCategoriesRepository(category);
    transactions.update = vi.fn((entity: Transaction) =>
      Promise.resolve({
        ...transaction,
        categoryId: entity.props.categoryId,
        categorizationStatus: entity.props.categorizationStatus,
        categorizationSource: entity.props.categorizationSource,
      }),
    );
    const scope = createScope(
      transactions,
      categories,
      (record) => {
        audited = record;
      },
    );
    const repository: TransactionsRepository = {
      withTenant: async (_context, operation) => operation(scope),
    };

    const result = await new UpdateTransactionCategory(repository).execute(
      context,
      transaction.id,
      randomUUID(),
      { categoryId: category.id },
    );

    expect(result).toMatchObject({
      categoryId: category.id,
      categorizationStatus: 'categorized',
      categorizationSource: 'manual',
    });
    expect(audited?.props).toMatchObject({
      action: 'transaction_category_updated',
      resourceType: 'transaction',
      resourceId: transaction.id,
    });
  });

  it('does not reveal a foreign category during correction', async () => {
    const context: TenantContext = {
      tenantId: randomUUID(),
      userId: randomUUID(),
    };
    const transaction = createTransactionSnapshot(context.tenantId);
    const transactions = createTransactionsRepository(transaction);
    const categories = createCategoriesRepository(null);
    const scope = createScope(transactions, categories, () => undefined);
    const repository: TransactionsRepository = {
      withTenant: async (_context, operation) => operation(scope),
    };

    await expect(
      new UpdateTransactionCategory(repository).execute(
        context,
        transaction.id,
        randomUUID(),
        { categoryId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(CategoryNotFound);
  });
});

function createTransactionSnapshot(tenantId: string): TransactionSnapshot {
  return {
    id: randomUUID(),
    tenantId,
    accountId: randomUUID(),
    type: 'expense',
    amount: '12.00',
    occurredOn: '2026-09-20',
    description: 'Mercado',
    status: 'posted',
    transferId: null,
    transferSide: null,
    categoryId: null,
    categorizationStatus: 'unclassified',
    categorizationSource: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  };
}

function createTransactionsRepository(
  snapshot: TransactionSnapshot,
): TenantTransactionsRepository {
  return {
    create: vi.fn(() => Promise.resolve(snapshot)),
    findById: vi.fn(() => Promise.resolve(snapshot)),
    findByIdForUpdate: vi.fn(() => Promise.resolve(snapshot)),
    findByIds: vi.fn(() => Promise.resolve([snapshot])),
    count: vi.fn(() => Promise.resolve(1)),
    findPage: vi.fn(() => Promise.resolve([snapshot])),
    update: vi.fn(() => Promise.resolve(snapshot)),
  };
}

function createCategoriesRepository(
  snapshot: CategorySnapshot | null,
): TenantCategoriesRepository {
  return {
    create: vi.fn((category: Category) => Promise.resolve({
      id: snapshot?.id ?? randomUUID(),
      tenantId: category.props.tenantId,
      name: category.props.name,
      source: category.props.source,
      status: category.props.status,
      archivedAt: category.props.archivedAt,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    })),
    findById: vi.fn(() => Promise.resolve(snapshot)),
    findByIdForUpdate: vi.fn(() => Promise.resolve(snapshot)),
    count: vi.fn(() => Promise.resolve(snapshot ? 1 : 0)),
    findPage: vi.fn(() => Promise.resolve(snapshot ? [snapshot] : [])),
    update: vi.fn(() =>
      snapshot
        ? Promise.resolve(snapshot)
        : Promise.reject(new Error('Missing category fixture.')),
    ),
  };
}

function createScope(
  transactions: TenantTransactionsRepository,
  categories: TenantCategoriesRepository,
  writeAudit: (record: AuditRecord) => void,
): TransactionPersistenceScope {
  const categoryRules: TenantCategoryRulesRepository = {
    create: vi.fn(() =>
      Promise.reject(new Error('Unused category rule fixture.')),
    ),
    findById: vi.fn(() => Promise.resolve(null)),
    findByIdForUpdate: vi.fn(() => Promise.resolve(null)),
    count: vi.fn(() => Promise.resolve(0)),
    findPage: vi.fn(() => Promise.resolve([])),
    findActiveForEvaluation: vi.fn(() => Promise.resolve([])),
    update: vi.fn(() =>
      Promise.reject(new Error('Unused category rule fixture.')),
    ),
  };
  const idempotency: TenantIdempotencyRepository = {
    find: vi.fn(() => Promise.resolve(null)),
    claim: vi.fn(() => Promise.reject(new Error('Unused idempotency fixture.'))),
    complete: vi.fn(() => Promise.resolve()),
  };
  return {
    transactions,
    categories,
    categoryRules,
    idempotency,
    audit: {
      write: (record) => {
        writeAudit(record);
        return Promise.resolve();
      },
    },
  };
}
