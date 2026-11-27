import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { Transaction } from '../../domain/transaction.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../transactions.errors.js';
import type { TransactionAccountImportEligibilityReader } from '../ports/transaction-account-import-eligibility.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import { createOfxExternalIdentityKey } from '../ofx-identity.js';

export type ImportOfxTransactionInput = Readonly<{
  accountId: string;
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description: string | null;
  externalId: string | null;
}>;

export type ImportOfxTransactionResult =
  | Readonly<{ disposition: 'imported'; transactionId: string }>
  | Readonly<{ disposition: 'duplicate' }>;

/** Resultado de uma linha no lote: gravada, duplicada ou recusada com um codigo conhecido. */
export type ImportOfxTransactionBatchOutcome =
  | ImportOfxTransactionResult
  | Readonly<{
      disposition: 'failed';
      errorCode: 'account_not_found' | 'account_archived' | 'invalid_request';
    }>;

export class ImportOfxTransaction {
  constructor(
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountState: TransactionAccountImportEligibilityReader,
  ) {}

  async execute(
    context: TenantContext,
    input: ImportOfxTransactionInput,
    requestId: string = randomUUID(),
  ): Promise<ImportOfxTransactionResult> {
    assertTenantContext(context);
    if (!isCanonicalUuid(input.accountId)) {
      throw new InvalidTransactionRequest('Invalid import account.');
    }

    const transaction = Transaction.createImported({
      tenantId: context.tenantId,
      accountId: input.accountId.toLowerCase(),
      type: input.type,
      amount: input.amount,
      occurredOn: input.occurredOn,
      description: input.description,
      externalIdentityKey: createOfxExternalIdentityKey(input),
    });

    const accountState = await this.accountState.getOwnedImportAvailability(
      context,
      transaction.props.accountId,
    );
    if (accountState === 'missing') throw new TransactionAccountNotFound();
    if (accountState.startsWith('archived_')) {
      throw new TransactionAccountArchived();
    }
    if (accountState !== 'active_local') {
      throw new InvalidTransactionRequest(
        'OFX imports require an active local account.',
      );
    }

    return this.unitOfWork.run(context, async (scope) => {
      const snapshot =
        await scope.transactions.createIfExternalIdentityAbsent(transaction);
      if (!snapshot) return { disposition: 'duplicate' };

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
      return { disposition: 'imported', transactionId: snapshot.id };
    });
  }

  /**
   * Importa varias linhas na mesma conta com uma unica verificacao da conta e uma unica transacao.
   * A resposta tem a mesma ordem da entrada. Linha invalida falha sozinha; problema da conta
   * falha todas, como `execute` faria uma a uma. Quem chama limita o tamanho do lote: a
   * transacao interativa do banco tem tempo maximo.
   */
  async executeMany(
    context: TenantContext,
    inputs: readonly ImportOfxTransactionInput[],
    requestIdFor: () => string = randomUUID,
  ): Promise<ImportOfxTransactionBatchOutcome[]> {
    assertTenantContext(context);
    if (inputs.length === 0) return [];
    if (inputs.some((input) => !isCanonicalUuid(input.accountId))) {
      return failedAll(inputs.length, 'invalid_request');
    }
    const accountId = (inputs[0]?.accountId ?? '').toLowerCase();
    if (inputs.some((input) => input.accountId.toLowerCase() !== accountId)) {
      return failedAll(inputs.length, 'invalid_request');
    }

    const accountState = await this.accountState.getOwnedImportAvailability(
      context,
      accountId,
    );
    if (accountState === 'missing') return failedAll(inputs.length, 'account_not_found');
    if (accountState.startsWith('archived_')) {
      return failedAll(inputs.length, 'account_archived');
    }
    if (accountState !== 'active_local') {
      return failedAll(inputs.length, 'invalid_request');
    }

    const outcomes = new Array<ImportOfxTransactionBatchOutcome>(inputs.length);
    const pending: { index: number; transaction: Transaction }[] = [];
    inputs.forEach((input, index) => {
      try {
        pending.push({
          index,
          transaction: Transaction.createImported({
            tenantId: context.tenantId,
            accountId,
            type: input.type,
            amount: input.amount,
            occurredOn: input.occurredOn,
            description: input.description,
            externalIdentityKey: createOfxExternalIdentityKey(input),
          }),
        });
      } catch (error) {
        if (!(error instanceof InvalidTransactionRequest)) throw error;
        outcomes[index] = { disposition: 'failed', errorCode: 'invalid_request' };
      }
    });

    await this.unitOfWork.run(context, async (scope) => {
      for (const { index, transaction } of pending) {
        const snapshot =
          await scope.transactions.createIfExternalIdentityAbsent(transaction);
        if (!snapshot) {
          outcomes[index] = { disposition: 'duplicate' };
          continue;
        }
        await scope.audit.write(
          AuditRecord.create({
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: 'transaction_created',
            resourceType: 'transaction',
            resourceId: snapshot.id,
            outcome: 'success',
            requestId: requestIdFor(),
            metadata: { changedFields: [] },
          }),
        );
        outcomes[index] = { disposition: 'imported', transactionId: snapshot.id };
      }
    });
    return outcomes;
  }
}

function failedAll(
  count: number,
  errorCode: Extract<
    ImportOfxTransactionBatchOutcome,
    { disposition: 'failed' }
  >['errorCode'],
): ImportOfxTransactionBatchOutcome[] {
  return Array.from({ length: count }, () => ({
    disposition: 'failed' as const,
    errorCode,
  }));
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
