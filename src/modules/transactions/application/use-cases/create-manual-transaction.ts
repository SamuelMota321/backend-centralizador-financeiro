import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { Transaction } from '../../domain/transaction.js';
import {
  assertReplayable,
  hashNormalizedPayload,
  isCanonicalUuid,
  TRANSACTION_CREATE_OPERATION,
} from '../idempotency.js';
import {
  InvalidTransactionRequest,
  IdempotencyRecordUnavailable,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../transactions.errors.js';
import type { TransactionView } from '../transactions-view.js';
import { toTransactionView } from '../transactions-view.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';

export type CreateManualTransactionCommand = Readonly<{
  accountId: string;
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description?: string | null;
}>;

export class CreateManualTransaction {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountState: TransactionAccountStateReader,
  ) {}

  async execute(
    context: TenantContext,
    idempotencyKey: string,
    input: CreateManualTransactionCommand,
  ): Promise<TransactionView> {
    assertTenantContext(context);
    assertMovementInput(input.accountId, idempotencyKey);
    const accountId = input.accountId.toLowerCase();

    const transaction = Transaction.createManual({
      tenantId: context.tenantId,
      accountId,
      type: input.type,
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description,
    });
    const payloadHash = hashNormalizedPayload({
      accountId: transaction.props.accountId,
      type: transaction.props.type,
      amount: transaction.props.amount.toDecimal(),
      occurredOn: transaction.props.occurredOn,
      description: transaction.props.description,
    });

    const replay = await this.transactions.withTenant(
      context,
      async (scope) => {
        const record = await scope.idempotency.find(
          TRANSACTION_CREATE_OPERATION,
          idempotencyKey,
        );
        if (!record) return null;
        assertReplayable(record, payloadHash);
        const snapshots = await scope.transactions.findByIds(
          record.resourceIds,
        );
        if (snapshots.length !== 1 || !snapshots[0]) {
          throw new IdempotencyRecordUnavailable();
        }
        return toTransactionView(snapshots[0]);
      },
    );
    if (replay) return replay;

    await assertActiveAccount(this.accountState, context, accountId);

    return this.unitOfWork.run(context, async (scope) => {
      const claim = await scope.idempotency.claim(
        TRANSACTION_CREATE_OPERATION,
        idempotencyKey,
        payloadHash,
      );
      if (!claim.claimed) {
        assertReplayable(claim.record, payloadHash);
        const snapshots = await scope.transactions.findByIds(
          claim.record.resourceIds,
        );
        if (snapshots.length !== 1 || !snapshots[0]) {
          throw new IdempotencyRecordUnavailable();
        }
        return toTransactionView(snapshots[0]);
      }

      const snapshot = await scope.transactions.create(transaction);
      await scope.idempotency.complete(claim.record.id, [snapshot.id]);
      return toTransactionView(snapshot);
    });
  }
}

async function assertActiveAccount(
  accountState: TransactionAccountStateReader,
  context: TenantContext,
  accountId: string,
): Promise<void> {
  const state = await accountState.getOwnedState(context, accountId);
  if (state === 'missing') throw new TransactionAccountNotFound();
  if (state === 'archived') throw new TransactionAccountArchived();
}

function assertMovementInput(accountId: string, idempotencyKey: string): void {
  if (!isCanonicalUuid(accountId) || idempotencyKey.length === 0) {
    throw new InvalidTransactionRequest('Invalid movement input.');
  }
}
