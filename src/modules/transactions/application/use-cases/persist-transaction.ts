import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { Transaction } from '../../domain/transaction.js';
import {
  TransactionAccountNotFound,
  TransactionsTenantMismatch,
} from '../transactions.errors.js';
import {
  toTransactionView,
  type TransactionView,
} from '../transactions-view.js';
import type { TransactionAccountOwnership } from '../ports/transaction-account-ownership.port.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';

export class PersistTransaction {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly accountOwnership: TransactionAccountOwnership,
  ) {}

  async execute(
    context: TenantContext,
    transaction: Transaction,
  ): Promise<TransactionView> {
    assertTenantContext(context);
    if (transaction.props.tenantId !== context.tenantId) {
      throw new TransactionsTenantMismatch(
        'Transaction ownership does not match the authenticated tenant.',
      );
    }

    const accountIsOwned = await this.accountOwnership.isActiveOwned(
      context,
      transaction.props.accountId,
    );
    if (!accountIsOwned) {
      throw new TransactionAccountNotFound(
        'The account was not found for the authenticated tenant.',
      );
    }

    return this.transactions.withTenant(context, async ({ transactions }) => {
      const snapshot = await transactions.create(transaction);
      return toTransactionView(snapshot);
    });
  }
}
