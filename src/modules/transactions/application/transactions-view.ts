import type { CategoryRuleSnapshot } from '../domain/category-rule.js';
import type { CategorySnapshot } from '../domain/category.js';
import type { TransactionSnapshot } from '../domain/transaction.js';

export type TransactionView = Readonly<{
  id: string;
  accountId: string;
  type: TransactionSnapshot['type'];
  amount: string;
  occurredOn: TransactionSnapshot['occurredOn'];
  description: string | null;
  status: TransactionSnapshot['status'];
  transferId: string | null;
  transferSide: TransactionSnapshot['transferSide'];
  categoryId: string | null;
  categorizationStatus: TransactionSnapshot['categorizationStatus'];
  categorizationSource: TransactionSnapshot['categorizationSource'];
  createdAt: string;
  updatedAt: string;
}>;

export type TransferView = Readonly<{
  entries: readonly [TransactionView, TransactionView];
}>;

export type CategoryView = Readonly<{
  id: string;
  name: string;
  source: CategorySnapshot['source'];
  status: CategorySnapshot['status'];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CategoryRuleView = Readonly<{
  id: string;
  categoryId: string;
  conditionField: CategoryRuleSnapshot['conditionField'];
  conditionOperator: CategoryRuleSnapshot['conditionOperator'];
  conditionValue: string;
  priority: number;
  status: CategoryRuleSnapshot['status'];
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type TransactionPage = Readonly<{
  items: readonly TransactionView[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type CategoryPage = Readonly<{
  items: readonly CategoryView[];
  page: number;
  pageSize: number;
  total: number;
}>;

export type CategoryRulePage = Readonly<{
  items: readonly CategoryRuleView[];
  page: number;
  pageSize: number;
  total: number;
}>;

export function toTransactionView(
  snapshot: TransactionSnapshot,
): TransactionView {
  return {
    id: snapshot.id,
    accountId: snapshot.accountId,
    type: snapshot.type,
    amount: snapshot.amount,
    occurredOn: snapshot.occurredOn,
    description: snapshot.description,
    status: snapshot.status,
    transferId: snapshot.transferId,
    transferSide: snapshot.transferSide,
    categoryId: snapshot.categoryId,
    categorizationStatus: snapshot.categorizationStatus,
    categorizationSource: snapshot.categorizationSource,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function toTransferView(
  outgoing: TransactionSnapshot,
  incoming: TransactionSnapshot,
): TransferView {
  return {
    entries: [toTransactionView(outgoing), toTransactionView(incoming)],
  };
}

export function toCategoryView(snapshot: CategorySnapshot): CategoryView {
  return {
    id: snapshot.id,
    name: snapshot.name,
    source: snapshot.source,
    status: snapshot.status,
    archivedAt: snapshot.archivedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

export function toCategoryRuleView(
  snapshot: CategoryRuleSnapshot,
): CategoryRuleView {
  return {
    id: snapshot.id,
    categoryId: snapshot.categoryId,
    conditionField: snapshot.conditionField,
    conditionOperator: snapshot.conditionOperator,
    conditionValue: snapshot.conditionValue,
    priority: snapshot.priority,
    status: snapshot.status,
    removedAt: snapshot.removedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}
