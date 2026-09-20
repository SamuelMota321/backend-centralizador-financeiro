import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import { TransactionNotFound } from '../transactions.errors.js';
import {
  toTransactionView,
  type TransactionView,
} from '../transactions-view.js';

export class GetTransaction {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    transactionId: string,
  ): Promise<TransactionView> {
    assertTenantContext(context);
    return this.transactions.withTenant(context, async ({ transactions }) => {
      const snapshot = await transactions.findById(transactionId);
      if (!snapshot || snapshot.tenantId !== context.tenantId) {
        throw new TransactionNotFound(
          'The transaction was not found for the authenticated tenant.',
        );
      }
      return toTransactionView(snapshot);
    });
  }
}
