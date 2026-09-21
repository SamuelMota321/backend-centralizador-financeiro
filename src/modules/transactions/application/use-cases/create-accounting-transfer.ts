import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { Transaction } from '../../domain/transaction.js';
import {
  assertReplayable,
  hashNormalizedPayload,
  isCanonicalUuid,
  TRANSFER_CREATE_OPERATION,
} from '../idempotency.js';
import {
  InvalidTransactionRequest,
  IdempotencyRecordUnavailable,
  TransactionAccountArchived,
  TransactionAccountNotFound,
  TransferAccountsMustDiffer,
} from '../transactions.errors.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import type { TransferView } from '../transactions-view.js';
import { toTransferView } from '../transactions-view.js';

export type CreateAccountingTransferCommand = Readonly<{
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  occurredOn: string;
  description?: string | null;
}>;

export class CreateAccountingTransfer {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountState: TransactionAccountStateReader,
  ) {}

  async execute(
    context: TenantContext,
    idempotencyKey: string,
    input: CreateAccountingTransferCommand,
  ): Promise<TransferView> {
    assertTenantContext(context);
    assertTransferInput(input, idempotencyKey);
    const fromAccountId = input.fromAccountId.toLowerCase();
    const toAccountId = input.toAccountId.toLowerCase();

    const transferId = randomUUID();
    const outgoing = Transaction.createTransferEntry({
      tenantId: context.tenantId,
      accountId: fromAccountId,
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description,
      transferId,
      transferSide: 'outgoing',
    });
    const incoming = Transaction.createTransferEntry({
      tenantId: context.tenantId,
      accountId: toAccountId,
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description,
      transferId,
      transferSide: 'incoming',
    });
    const payloadHash = hashNormalizedPayload({
      fromAccountId: outgoing.props.accountId,
      toAccountId: incoming.props.accountId,
      amount: outgoing.props.amount.toDecimal(),
      occurredOn: outgoing.props.occurredOn,
      description: outgoing.props.description,
    });

    const replay = await this.transactions.withTenant(
      context,
      async (scope) => {
        const record = await scope.idempotency.find(
          TRANSFER_CREATE_OPERATION,
          idempotencyKey,
        );
        if (!record) return null;
        assertReplayable(record, payloadHash);
        const snapshots = await scope.transactions.findByIds(
          record.resourceIds,
        );
        if (
          snapshots.length !== 2 ||
          !snapshots[0] ||
          !snapshots[1] ||
          snapshots[0].transferSide !== 'outgoing' ||
          snapshots[1].transferSide !== 'incoming'
        ) {
          throw new IdempotencyRecordUnavailable();
        }
        return toTransferView(snapshots[0], snapshots[1]);
      },
    );
    if (replay) return replay;

    await assertActiveAccounts(this.accountState, context, [
      fromAccountId,
      toAccountId,
    ]);

    return this.unitOfWork.run(context, async (scope) => {
      const claim = await scope.idempotency.claim(
        TRANSFER_CREATE_OPERATION,
        idempotencyKey,
        payloadHash,
      );
      if (!claim.claimed) {
        assertReplayable(claim.record, payloadHash);
        const snapshots = await scope.transactions.findByIds(
          claim.record.resourceIds,
        );
        if (
          snapshots.length !== 2 ||
          !snapshots[0] ||
          !snapshots[1] ||
          snapshots[0].transferSide !== 'outgoing' ||
          snapshots[1].transferSide !== 'incoming'
        ) {
          throw new IdempotencyRecordUnavailable();
        }
        return toTransferView(snapshots[0], snapshots[1]);
      }

      const outgoingSnapshot = await scope.transactions.create(outgoing);
      const incomingSnapshot = await scope.transactions.create(incoming);
      await scope.idempotency.complete(claim.record.id, [
        outgoingSnapshot.id,
        incomingSnapshot.id,
      ]);
      return toTransferView(outgoingSnapshot, incomingSnapshot);
    });
  }
}

async function assertActiveAccounts(
  accountState: TransactionAccountStateReader,
  context: TenantContext,
  accountIds: readonly [string, string],
): Promise<void> {
  for (const accountId of accountIds) {
    const state = await accountState.getOwnedState(context, accountId);
    if (state === 'missing') throw new TransactionAccountNotFound();
    if (state === 'archived') throw new TransactionAccountArchived();
  }
}

function assertTransferInput(
  input: CreateAccountingTransferCommand,
  idempotencyKey: string,
): void {
  if (
    !isCanonicalUuid(input.fromAccountId) ||
    !isCanonicalUuid(input.toAccountId) ||
    idempotencyKey.length === 0
  ) {
    throw new InvalidTransactionRequest('Invalid movement input.');
  }
  if (input.fromAccountId.toLowerCase() === input.toAccountId.toLowerCase()) {
    throw new TransferAccountsMustDiffer();
  }
}
