import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { CategoryRule } from '../../domain/category-rule.js';
import {
  Transaction,
  type TransactionSnapshot,
} from '../../domain/transaction.js';
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
    requestId: string = randomUUID(),
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
        assertReplayable(record, payloadHash, context.tenantId, 1);
        const snapshots = await scope.transactions.findByIds(
          record.resourceIds,
        );
        if (
          snapshots.length !== 1 ||
          !snapshots[0] ||
          !matchesManualCommand(snapshots[0], transaction)
        ) {
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
        assertReplayable(claim.record, payloadHash, context.tenantId, 1);
        const snapshots = await scope.transactions.findByIds(
          claim.record.resourceIds,
        );
        if (
          snapshots.length !== 1 ||
          !snapshots[0] ||
          !matchesManualCommand(snapshots[0], transaction)
        ) {
          throw new IdempotencyRecordUnavailable();
        }
        return toTransactionView(snapshots[0]);
      }

      const activeRules = await scope.categoryRules.findActiveForEvaluation();
      const matchingRule = activeRules
        .map((ruleSnapshot) => CategoryRule.reconstitute(ruleSnapshot))
        .find((rule) => rule.matches(transaction));
      const transactionToPersist = matchingRule
        ? transaction.categorize(
            matchingRule.props.categoryId,
            'rule',
            new Date().toISOString(),
          )
        : transaction;
      const snapshot = await scope.transactions.create(transactionToPersist);
      await scope.idempotency.complete(claim.record.id, [snapshot.id]);
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
  if (
    !isCanonicalUuid(accountId) ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > 255
  ) {
    throw new InvalidTransactionRequest('Invalid movement input.');
  }
}

function matchesManualCommand(
  snapshot: TransactionSnapshot,
  transaction: Transaction,
): boolean {
  return (
    snapshot.tenantId === transaction.props.tenantId &&
    snapshot.accountId === transaction.props.accountId &&
    snapshot.type === transaction.props.type &&
    snapshot.amount === transaction.props.amount.toDecimal() &&
    snapshot.occurredOn === transaction.props.occurredOn &&
    snapshot.description === transaction.props.description &&
    snapshot.transferId === null &&
    snapshot.transferSide === null
  );
}
