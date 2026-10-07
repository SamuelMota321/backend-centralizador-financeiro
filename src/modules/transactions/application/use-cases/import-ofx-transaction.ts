import { createHash, randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { Transaction } from '../../domain/transaction.js';
import { TransactionAmount } from '../../domain/transaction-amount.js';
import { parseCivilDate } from '../../domain/civil-date.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../transactions.errors.js';
import type { TransactionAccountImportEligibilityReader } from '../ports/transaction-account-import-eligibility.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';

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
      externalIdentityKey: createExternalIdentityKey(input),
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
}

function createExternalIdentityKey(input: ImportOfxTransactionInput): string {
  const externalId = input.externalId?.trim() ?? '';
  if (externalId.length > 255) {
    throw new InvalidTransactionRequest('Invalid external transaction ID.');
  }

  const identity = externalId
    ? `fitid\u0000${externalId}`
    : [
        'fallback',
        parseCivilDate(input.occurredOn),
        input.type === 'income' ? '+' : '-',
        TransactionAmount.fromDecimal(input.amount).toDecimal(),
        normalizeDescription(input.description) ?? '',
      ].join('\u0000');
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

function normalizeDescription(value: string | null): string | null {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  return normalized === '' ? null : normalized;
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
