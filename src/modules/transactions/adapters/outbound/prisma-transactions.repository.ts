import { Injectable } from '@nestjs/common';
import {
  CategorizationSource as PrismaCategorizationSource,
  CategorizationStatus as PrismaCategorizationStatus,
  CategoryRuleConditionField as PrismaCategoryRuleConditionField,
  CategoryRuleOperator as PrismaCategoryRuleOperator,
  CategoryRuleStatus as PrismaCategoryRuleStatus,
  CategorySource as PrismaCategorySource,
  CategoryStatus as PrismaCategoryStatus,
  Prisma,
  TransactionStatus as PrismaTransactionStatus,
  TransactionType as PrismaTransactionType,
  TransferSide as PrismaTransferSide,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type {
  CategoryRule,
  CategoryRuleSnapshot,
} from '../../domain/category-rule.js';
import type { Category, CategorySnapshot } from '../../domain/category.js';
import type {
  Transaction,
  TransactionSnapshot,
  TransactionStatus,
  TransferSide,
  CategorizationStatus,
  CategorizationSource,
} from '../../domain/transaction.js';
import type {
  CategoryRuleConditionField,
  CategoryRuleOperator,
  CategoryRuleStatus,
} from '../../domain/category-rule.js';
import type { CategorySource, CategoryStatus } from '../../domain/category.js';
import type { TransactionType } from '../../domain/transaction-type.js';
import type {
  TenantCategoriesRepository,
  TenantCategoryRulesRepository,
  TenantTransactionsRepository,
  TransactionPersistenceScope,
  TransactionsRepository,
} from '../../application/ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../../application/ports/transactions.unit-of-work.port.js';
import { TransactionsTenantMismatch } from '../../application/transactions.errors.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import { PrismaAuditWriter } from '../../../audit/adapters/outbound/prisma-audit-writer.js';
import { PrismaTenantIdempotencyRepository } from './prisma-idempotency.repository.js';
import {
  CategoryNotFound,
  CategoryNameConflict,
  TransactionNotFound,
} from '../../application/transactions.errors.js';
import { CategoryRuleNotFound } from '../../domain/transactions.errors.js';

const transactionSelect = {
  id: true,
  tenantId: true,
  accountId: true,
  type: true,
  amount: true,
  occurredOn: true,
  description: true,
  status: true,
  transferId: true,
  transferSide: true,
  categoryId: true,
  categorizationStatus: true,
  categorizationSource: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TransactionSelect;

const categorySelect = {
  id: true,
  tenantId: true,
  name: true,
  source: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

const categoryRuleSelect = {
  id: true,
  tenantId: true,
  categoryId: true,
  conditionField: true,
  conditionOperator: true,
  conditionValue: true,
  priority: true,
  status: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategoryRuleSelect;

type TransactionRecord = Prisma.TransactionGetPayload<{
  select: typeof transactionSelect;
}>;
type CategoryRecord = Prisma.CategoryGetPayload<{
  select: typeof categorySelect;
}>;
type CategoryRuleRecord = Prisma.CategoryRuleGetPayload<{
  select: typeof categoryRuleSelect;
}>;

const TO_PRISMA_TRANSACTION_TYPE: Record<
  TransactionType,
  PrismaTransactionType
> = {
  income: PrismaTransactionType.INCOME,
  expense: PrismaTransactionType.EXPENSE,
  transfer: PrismaTransactionType.TRANSFER,
};

const FROM_PRISMA_TRANSACTION_TYPE: Record<
  PrismaTransactionType,
  TransactionType
> = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
};

const TO_PRISMA_TRANSACTION_STATUS: Record<
  TransactionStatus,
  PrismaTransactionStatus
> = {
  posted: PrismaTransactionStatus.POSTED,
  voided: PrismaTransactionStatus.VOIDED,
};

const FROM_PRISMA_TRANSACTION_STATUS: Record<
  PrismaTransactionStatus,
  TransactionStatus
> = {
  POSTED: 'posted',
  VOIDED: 'voided',
};

const TO_PRISMA_TRANSFER_SIDE: Record<TransferSide, PrismaTransferSide> = {
  outgoing: PrismaTransferSide.OUTGOING,
  incoming: PrismaTransferSide.INCOMING,
};

const FROM_PRISMA_TRANSFER_SIDE: Record<PrismaTransferSide, TransferSide> = {
  OUTGOING: 'outgoing',
  INCOMING: 'incoming',
};

const TO_PRISMA_CATEGORIZATION_STATUS: Record<
  CategorizationStatus,
  PrismaCategorizationStatus
> = {
  unclassified: PrismaCategorizationStatus.UNCLASSIFIED,
  categorized: PrismaCategorizationStatus.CATEGORIZED,
  uncertain: PrismaCategorizationStatus.UNCERTAIN,
  unrecognized: PrismaCategorizationStatus.UNRECOGNIZED,
  not_applicable: PrismaCategorizationStatus.NOT_APPLICABLE,
};

const FROM_PRISMA_CATEGORIZATION_STATUS: Record<
  PrismaCategorizationStatus,
  CategorizationStatus
> = {
  UNCLASSIFIED: 'unclassified',
  CATEGORIZED: 'categorized',
  UNCERTAIN: 'uncertain',
  UNRECOGNIZED: 'unrecognized',
  NOT_APPLICABLE: 'not_applicable',
};

const TO_PRISMA_CATEGORIZATION_SOURCE: Record<
  CategorizationSource,
  PrismaCategorizationSource
> = {
  manual: PrismaCategorizationSource.MANUAL,
  rule: PrismaCategorizationSource.RULE,
};

const FROM_PRISMA_CATEGORIZATION_SOURCE: Record<
  PrismaCategorizationSource,
  CategorizationSource
> = {
  MANUAL: 'manual',
  RULE: 'rule',
};

const TO_PRISMA_CATEGORY_SOURCE: Record<CategorySource, PrismaCategorySource> =
  {
    user: PrismaCategorySource.USER,
  };

const FROM_PRISMA_CATEGORY_SOURCE: Record<
  PrismaCategorySource,
  CategorySource
> = {
  USER: 'user',
};

const TO_PRISMA_CATEGORY_STATUS: Record<CategoryStatus, PrismaCategoryStatus> =
  {
    active: PrismaCategoryStatus.ACTIVE,
    archived: PrismaCategoryStatus.ARCHIVED,
  };

const FROM_PRISMA_CATEGORY_STATUS: Record<
  PrismaCategoryStatus,
  CategoryStatus
> = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

const TO_PRISMA_RULE_FIELD: Record<
  CategoryRuleConditionField,
  PrismaCategoryRuleConditionField
> = {
  description: PrismaCategoryRuleConditionField.DESCRIPTION,
  type: PrismaCategoryRuleConditionField.TYPE,
  accountId: PrismaCategoryRuleConditionField.ACCOUNT_ID,
};

const FROM_PRISMA_RULE_FIELD: Record<
  PrismaCategoryRuleConditionField,
  CategoryRuleConditionField
> = {
  DESCRIPTION: 'description',
  TYPE: 'type',
  ACCOUNT_ID: 'accountId',
};

const TO_PRISMA_RULE_OPERATOR: Record<
  CategoryRuleOperator,
  PrismaCategoryRuleOperator
> = {
  equals: PrismaCategoryRuleOperator.EQUALS,
  contains: PrismaCategoryRuleOperator.CONTAINS,
  starts_with: PrismaCategoryRuleOperator.STARTS_WITH,
  ends_with: PrismaCategoryRuleOperator.ENDS_WITH,
};

const FROM_PRISMA_RULE_OPERATOR: Record<
  PrismaCategoryRuleOperator,
  CategoryRuleOperator
> = {
  EQUALS: 'equals',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
};

const TO_PRISMA_RULE_STATUS: Record<
  CategoryRuleStatus,
  PrismaCategoryRuleStatus
> = {
  active: PrismaCategoryRuleStatus.ACTIVE,
  inactive: PrismaCategoryRuleStatus.INACTIVE,
  removed: PrismaCategoryRuleStatus.REMOVED,
};

const FROM_PRISMA_RULE_STATUS: Record<
  PrismaCategoryRuleStatus,
  CategoryRuleStatus
> = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  REMOVED: 'removed',
};

@Injectable()
export class PrismaTransactionsRepository
  implements TransactionsRepository, TransactionsUnitOfWork
{
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  withTenant<Result>(
    context: TenantContext,
    operation: (scope: TransactionPersistenceScope) => Promise<Result>,
  ): Promise<Result> {
    assertTenantContext(context);
    return this.tenantTransaction.run(context, async (transaction) =>
      operation(new PrismaTransactionsPersistenceScope(transaction, context)),
    );
  }

  run<Result>(
    context: TenantContext,
    operation: (scope: TransactionPersistenceScope) => Promise<Result>,
  ): Promise<Result> {
    return this.withTenant(context, operation);
  }
}

class PrismaTransactionsPersistenceScope implements TransactionPersistenceScope {
  readonly transactions: TenantTransactionsRepository;
  readonly categories: TenantCategoriesRepository;
  readonly categoryRules: TenantCategoryRulesRepository;
  readonly idempotency: PrismaTenantIdempotencyRepository;
  readonly audit: AuditWriter;

  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {
    this.transactions = new PrismaTenantTransactionsRepository(
      transaction,
      context,
    );
    this.categories = new PrismaTenantCategoriesRepository(
      transaction,
      context,
    );
    this.categoryRules = new PrismaTenantCategoryRulesRepository(
      transaction,
      context,
    );
    this.idempotency = new PrismaTenantIdempotencyRepository(
      transaction,
      context,
    );
    this.audit = new PrismaAuditWriter(transaction);
  }
}

class PrismaTenantTransactionsRepository implements TenantTransactionsRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async create(transaction: Transaction): Promise<TransactionSnapshot> {
    assertEntityTenant(transaction.props.tenantId, this.context);
    const record = await this.transaction.transaction.create({
      data: {
        tenantId: this.context.tenantId,
        accountId: transaction.props.accountId,
        type: TO_PRISMA_TRANSACTION_TYPE[transaction.props.type],
        amount: transaction.props.amount.toDecimal(),
        occurredOn: toDate(transaction.props.occurredOn),
        description: transaction.props.description,
        status: TO_PRISMA_TRANSACTION_STATUS[transaction.props.status],
        transferId: transaction.props.transferId,
        transferSide: transaction.props.transferSide
          ? TO_PRISMA_TRANSFER_SIDE[transaction.props.transferSide]
          : null,
        categoryId: transaction.props.categoryId,
        categorizationStatus:
          TO_PRISMA_CATEGORIZATION_STATUS[
            transaction.props.categorizationStatus
          ],
        categorizationSource: transaction.props.categorizationSource
          ? TO_PRISMA_CATEGORIZATION_SOURCE[
              transaction.props.categorizationSource
            ]
          : null,
      },
      select: transactionSelect,
    });
    return toTransactionSnapshot(record);
  }

  async findById(transactionId: string): Promise<TransactionSnapshot | null> {
    const record = await this.transaction.transaction.findFirst({
      where: { id: transactionId, tenantId: this.context.tenantId },
      select: transactionSelect,
    });
    return record ? toTransactionSnapshot(record) : null;
  }

  async findByIdForUpdate(
    transactionId: string,
  ): Promise<TransactionSnapshot | null> {
    await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM public.transactions
      WHERE id = ${transactionId}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
      FOR UPDATE
    `;
    return this.findById(transactionId);
  }

  async findByIds(
    transactionIds: readonly string[],
  ): Promise<TransactionSnapshot[]> {
    if (transactionIds.length === 0) return [];

    const records = await this.transaction.transaction.findMany({
      where: {
        id: { in: [...transactionIds] },
        tenantId: this.context.tenantId,
      },
      select: transactionSelect,
    });
    const recordsById = new Map(
      records.map((record) => [record.id, toTransactionSnapshot(record)]),
    );
    return transactionIds.flatMap((transactionId) => {
      const snapshot = recordsById.get(transactionId);
      return snapshot ? [snapshot] : [];
    });
  }

  count(): Promise<number> {
    return this.transaction.transaction.count({
      where: { tenantId: this.context.tenantId },
    });
  }

  async findPage(
    offset: number,
    limit: number,
  ): Promise<TransactionSnapshot[]> {
    const records = await this.transaction.transaction.findMany({
      where: { tenantId: this.context.tenantId },
      orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: transactionSelect,
    });
    return records.map(toTransactionSnapshot);
  }

  async update(transaction: Transaction): Promise<TransactionSnapshot> {
    assertEntityTenant(transaction.props.tenantId, this.context);
    const transactionId = transaction.snapshot?.id;
    if (!transactionId) throw new TransactionNotFound();
    const result = await this.transaction.transaction.updateMany({
      where: { id: transactionId, tenantId: this.context.tenantId },
      data: {
        categoryId: transaction.props.categoryId,
        categorizationStatus:
          TO_PRISMA_CATEGORIZATION_STATUS[
            transaction.props.categorizationStatus
          ],
        categorizationSource: transaction.props.categorizationSource
          ? TO_PRISMA_CATEGORIZATION_SOURCE[
              transaction.props.categorizationSource
            ]
          : null,
      },
    });
    if (result.count !== 1) {
      throw new TransactionNotFound();
    }
    const snapshot = await this.findById(transactionId);
    if (!snapshot) throw new TransactionNotFound();
    return snapshot;
  }
}

class PrismaTenantCategoriesRepository implements TenantCategoriesRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async create(category: Category): Promise<CategorySnapshot> {
    assertEntityTenant(category.props.tenantId, this.context);
    let record: CategoryRecord;
    try {
      record = await this.transaction.category.create({
        data: {
          tenantId: this.context.tenantId,
          name: category.props.name,
          source: TO_PRISMA_CATEGORY_SOURCE[category.props.source],
          status: TO_PRISMA_CATEGORY_STATUS[category.props.status],
          archivedAt: category.props.archivedAt
            ? new Date(category.props.archivedAt)
            : null,
        },
        select: categorySelect,
      });
    } catch (error: unknown) {
      if (isPrismaUniqueViolation(error)) {
        throw new CategoryNameConflict();
      }
      throw error;
    }
    return toCategorySnapshot(record);
  }

  async findById(categoryId: string): Promise<CategorySnapshot | null> {
    const record = await this.transaction.category.findFirst({
      where: { id: categoryId, tenantId: this.context.tenantId },
      select: categorySelect,
    });
    return record ? toCategorySnapshot(record) : null;
  }

  async findByIdForUpdate(
    categoryId: string,
  ): Promise<CategorySnapshot | null> {
    await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM public.categories
      WHERE id = ${categoryId}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
      FOR UPDATE
    `;
    return this.findById(categoryId);
  }

  count(): Promise<number> {
    return this.transaction.category.count({
      where: { tenantId: this.context.tenantId },
    });
  }

  async findPage(offset: number, limit: number): Promise<CategorySnapshot[]> {
    const records = await this.transaction.category.findMany({
      where: { tenantId: this.context.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: categorySelect,
    });
    return records.map(toCategorySnapshot);
  }

  async update(category: Category): Promise<CategorySnapshot> {
    assertEntityTenant(category.props.tenantId, this.context);
    const categoryId = category.snapshot?.id;
    if (!categoryId) throw new CategoryNotFound();
    const result = await this.transaction.category.updateMany({
      where: { id: categoryId, tenantId: this.context.tenantId },
      data: {
        name: category.props.name,
        status: TO_PRISMA_CATEGORY_STATUS[category.props.status],
        archivedAt: category.props.archivedAt
          ? new Date(category.props.archivedAt)
          : null,
      },
    });
    if (result.count !== 1) {
      throw new CategoryNotFound();
    }
    const snapshot = await this.findById(categoryId);
    if (!snapshot) throw new CategoryNotFound();
    return snapshot;
  }
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002') ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002')
  );
}

class PrismaTenantCategoryRulesRepository implements TenantCategoryRulesRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async create(rule: CategoryRule): Promise<CategoryRuleSnapshot> {
    assertEntityTenant(rule.props.tenantId, this.context);
    const record = await this.transaction.categoryRule.create({
      data: {
        tenantId: this.context.tenantId,
        categoryId: rule.props.categoryId,
        conditionField: TO_PRISMA_RULE_FIELD[rule.props.conditionField],
        conditionOperator:
          TO_PRISMA_RULE_OPERATOR[rule.props.conditionOperator],
        conditionValue: rule.props.conditionValue,
        priority: rule.props.priority,
        status: TO_PRISMA_RULE_STATUS[rule.props.status],
        removedAt: rule.props.removedAt ? new Date(rule.props.removedAt) : null,
      },
      select: categoryRuleSelect,
    });
    return toCategoryRuleSnapshot(record);
  }

  async findById(categoryRuleId: string): Promise<CategoryRuleSnapshot | null> {
    const record = await this.transaction.categoryRule.findFirst({
      where: { id: categoryRuleId, tenantId: this.context.tenantId },
      select: categoryRuleSelect,
    });
    return record ? toCategoryRuleSnapshot(record) : null;
  }

  async findByIdForUpdate(
    categoryRuleId: string,
  ): Promise<CategoryRuleSnapshot | null> {
    await this.transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM public.category_rules
      WHERE id = ${categoryRuleId}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
      FOR UPDATE
    `;
    return this.findById(categoryRuleId);
  }

  count(): Promise<number> {
    return this.transaction.categoryRule.count({
      where: { tenantId: this.context.tenantId },
    });
  }

  async findPage(
    offset: number,
    limit: number,
  ): Promise<CategoryRuleSnapshot[]> {
    const records = await this.transaction.categoryRule.findMany({
      where: { tenantId: this.context.tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit,
      select: categoryRuleSelect,
    });
    return records.map(toCategoryRuleSnapshot);
  }

  async findActiveForEvaluation(): Promise<CategoryRuleSnapshot[]> {
    const records = await this.transaction.categoryRule.findMany({
      where: {
        tenantId: this.context.tenantId,
        status: PrismaCategoryRuleStatus.ACTIVE,
        category: {
          status: PrismaCategoryStatus.ACTIVE,
          tenantId: this.context.tenantId,
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: categoryRuleSelect,
    });
    return records.map(toCategoryRuleSnapshot);
  }

  async update(rule: CategoryRule): Promise<CategoryRuleSnapshot> {
    assertEntityTenant(rule.props.tenantId, this.context);
    const ruleId = rule.snapshot?.id;
    if (!ruleId) throw new CategoryRuleNotFound();
    const result = await this.transaction.categoryRule.updateMany({
      where: { id: ruleId, tenantId: this.context.tenantId },
      data: {
        categoryId: rule.props.categoryId,
        conditionField: TO_PRISMA_RULE_FIELD[rule.props.conditionField],
        conditionOperator:
          TO_PRISMA_RULE_OPERATOR[rule.props.conditionOperator],
        conditionValue: rule.props.conditionValue,
        priority: rule.props.priority,
        status: TO_PRISMA_RULE_STATUS[rule.props.status],
        removedAt: rule.props.removedAt ? new Date(rule.props.removedAt) : null,
      },
    });
    if (result.count !== 1) {
      throw new CategoryRuleNotFound();
    }
    const snapshot = await this.findById(ruleId);
    if (!snapshot) throw new CategoryRuleNotFound();
    return snapshot;
  }
}

function assertEntityTenant(
  entityTenantId: string,
  context: TenantContext,
): void {
  if (entityTenantId !== context.tenantId) {
    throw new TransactionsTenantMismatch();
  }
}

function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toTransactionSnapshot(record: TransactionRecord): TransactionSnapshot {
  const snapshot: TransactionSnapshot = {
    id: record.id,
    tenantId: record.tenantId,
    accountId: record.accountId,
    type: FROM_PRISMA_TRANSACTION_TYPE[record.type],
    amount: record.amount.toFixed(2),
    occurredOn: record.occurredOn.toISOString().slice(0, 10),
    description: record.description,
    status: FROM_PRISMA_TRANSACTION_STATUS[record.status],
    transferId: record.transferId,
    transferSide: record.transferSide
      ? FROM_PRISMA_TRANSFER_SIDE[record.transferSide]
      : null,
    categoryId: record.categoryId,
    categorizationStatus:
      FROM_PRISMA_CATEGORIZATION_STATUS[record.categorizationStatus],
    categorizationSource: record.categorizationSource
      ? FROM_PRISMA_CATEGORIZATION_SOURCE[record.categorizationSource]
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
  return snapshot;
}

function toCategorySnapshot(record: CategoryRecord): CategorySnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    source: FROM_PRISMA_CATEGORY_SOURCE[record.source],
    status: FROM_PRISMA_CATEGORY_STATUS[record.status],
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toCategoryRuleSnapshot(
  record: CategoryRuleRecord,
): CategoryRuleSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    categoryId: record.categoryId,
    conditionField: FROM_PRISMA_RULE_FIELD[record.conditionField],
    conditionOperator: FROM_PRISMA_RULE_OPERATOR[record.conditionOperator],
    conditionValue: record.conditionValue,
    priority: record.priority,
    status: FROM_PRISMA_RULE_STATUS[record.status],
    removedAt: record.removedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
