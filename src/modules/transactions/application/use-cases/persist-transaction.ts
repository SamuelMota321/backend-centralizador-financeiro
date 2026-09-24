import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { Transaction } from '../../domain/transaction.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import {
  InvalidTransactionRequest,
  TransactionAccountNotFound,
  TransactionsTenantMismatch,
} from '../transactions.errors.js';
import {
  toTransactionView,
  type TransactionView,
} from '../transactions-view.js';
import type { TransactionAccountOwnership } from '../ports/transaction-account-ownership.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';

export class PersistTransaction {
  constructor(
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountOwnership: TransactionAccountOwnership,
  ) {}

  async execute(
    context: TenantContext,
    transaction: Transaction,
    requestId: string = randomUUID(),
  ): Promise<TransactionView> {
    assertTenantContext(context);
    if (transaction.props.type === 'transfer') {
      throw new InvalidTransactionRequest(
        'Transfer entries must be persisted as an atomic pair.',
      );
    }
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

    return this.unitOfWork.run(context, async (scope) => {
      const snapshot = await scope.transactions.create(transaction);
      await scope.audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'transaction_created',
          resourceType: 'transaction',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: { changedFields: [] },
        }),
      );
      return toTransactionView(snapshot);
    });
  }
}
