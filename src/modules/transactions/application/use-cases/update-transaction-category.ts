import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { Transaction } from '../../domain/transaction.js';
import {
  CategoryArchived,
  CategoryNotFound,
  TransactionNotFound,
} from '../transactions.errors.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import {
  toTransactionView,
  type TransactionView,
} from '../transactions-view.js';

export type UpdateTransactionCategoryInput =
  | Readonly<{ categoryId: string }>
  | Readonly<{
      categorizationStatus: 'uncertain' | 'unrecognized';
    }>;

export class UpdateTransactionCategory {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    transactionId: string,
    requestId: string = randomUUID(),
    input: UpdateTransactionCategoryInput,
  ): Promise<TransactionView> {
    assertTenantContext(context);
    return this.transactions.withTenant(context, async (scope) => {
      const current = await scope.transactions.findByIdForUpdate(transactionId);
      if (!current || current.tenantId !== context.tenantId) {
        throw new TransactionNotFound(
          'The transaction was not found for the authenticated tenant.',
        );
      }

      const transaction = Transaction.reconstitute(current);
      const updated =
        'categoryId' in input
          ? await this.categorize(scope, context, transaction, input.categoryId)
          : transaction.markUncertain(
              input.categorizationStatus,
              new Date().toISOString(),
            );
      const snapshot = await scope.transactions.update(updated);
      await scope.audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'transaction_category_updated',
          resourceType: 'transaction',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: {
            changedFields: [
              'categoryId',
              'categorizationStatus',
              'categorizationSource',
            ],
          },
        }),
      );
      return toTransactionView(snapshot);
    });
  }

  private async categorize(
    scope: Parameters<Parameters<TransactionsRepository['withTenant']>[1]>[0],
    context: TenantContext,
    transaction: Transaction,
    categoryId: string,
  ): Promise<Transaction> {
    const category = await scope.categories.findById(categoryId);
    if (!category || category.tenantId !== context.tenantId) {
      throw new CategoryNotFound(
        'The category was not found for the authenticated tenant.',
      );
    }
    if (category.status === 'archived') {
      throw new CategoryArchived(
        'Archived categories cannot be assigned to transactions.',
      );
    }
    return transaction.categorize(
      category.id,
      'manual',
      new Date().toISOString(),
    );
  }
}
