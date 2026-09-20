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

export const TRANSACTIONS_REPOSITORY = Symbol('TRANSACTIONS_REPOSITORY');

export interface TenantTransactionsRepository {
  create(transaction: Transaction): Promise<TransactionSnapshot>;
  findById(transactionId: string): Promise<TransactionSnapshot | null>;
}

export interface TenantCategoriesRepository {
  create(category: Category): Promise<CategorySnapshot>;
  findById(categoryId: string): Promise<CategorySnapshot | null>;
}

export interface TenantCategoryRulesRepository {
  create(rule: CategoryRule): Promise<CategoryRuleSnapshot>;
  findById(ruleId: string): Promise<CategoryRuleSnapshot | null>;
}

export type TransactionPersistenceScope = Readonly<{
  transactions: TenantTransactionsRepository;
  categories: TenantCategoriesRepository;
  categoryRules: TenantCategoryRulesRepository;
}>;

export interface TransactionsRepository {
  withTenant<Result>(
    context: TenantContext,
    operation: (scope: TransactionPersistenceScope) => Promise<Result>,
  ): Promise<Result>;
}
