import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { Category, CategorySnapshot } from '../../domain/category.js';
import type {
  CategoryRule,
  CategoryRuleSnapshot,
} from '../../domain/category-rule.js';
import type {
  Transaction,
  TransactionSnapshot,
} from '../../domain/transaction.js';
import type { TenantIdempotencyRepository } from './idempotency.repository.port.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';

export const TRANSACTIONS_REPOSITORY = Symbol('TRANSACTIONS_REPOSITORY');

export interface TenantTransactionsRepository {
  create(transaction: Transaction): Promise<TransactionSnapshot>;
  findById(transactionId: string): Promise<TransactionSnapshot | null>;
  findByIdForUpdate(transactionId: string): Promise<TransactionSnapshot | null>;
  findByIds(transactionIds: readonly string[]): Promise<TransactionSnapshot[]>;
  count(): Promise<number>;
  findPage(offset: number, limit: number): Promise<TransactionSnapshot[]>;
  update(transaction: Transaction): Promise<TransactionSnapshot>;
}

export interface TenantCategoriesRepository {
  create(category: Category): Promise<CategorySnapshot>;
  findById(categoryId: string): Promise<CategorySnapshot | null>;
  findByIdForUpdate(categoryId: string): Promise<CategorySnapshot | null>;
  count(): Promise<number>;
  findPage(offset: number, limit: number): Promise<CategorySnapshot[]>;
  update(category: Category): Promise<CategorySnapshot>;
}

export interface TenantCategoryRulesRepository {
  create(rule: CategoryRule): Promise<CategoryRuleSnapshot>;
  findById(ruleId: string): Promise<CategoryRuleSnapshot | null>;
  findByIdForUpdate(ruleId: string): Promise<CategoryRuleSnapshot | null>;
  count(): Promise<number>;
  findPage(offset: number, limit: number): Promise<CategoryRuleSnapshot[]>;
  findActiveForEvaluation(): Promise<CategoryRuleSnapshot[]>;
  update(rule: CategoryRule): Promise<CategoryRuleSnapshot>;
}

export type TransactionPersistenceScope = Readonly<{
  transactions: TenantTransactionsRepository;
  categories: TenantCategoriesRepository;
  categoryRules: TenantCategoryRulesRepository;
  idempotency: TenantIdempotencyRepository;
  audit: AuditWriter;
}>;

export interface TransactionsRepository {
  withTenant<Result>(
    context: TenantContext,
    operation: (scope: TransactionPersistenceScope) => Promise<Result>,
  ): Promise<Result>;
}
