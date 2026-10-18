import { createHash, randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { Transaction } from '../../domain/transaction.js';
import type { TransactionAccountImportEligibilityReader } from '../ports/transaction-account-import-eligibility.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../transactions.errors.js';

export type ImportPluggyTransactionInput = Readonly<{
  connectionId: string;
  accountId: string;
  providerAccountId: string;
  providerTransactionId: string;
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description: string | null;
}>;

export type ImportPluggyTransactionResult =
  | Readonly<{ disposition: 'imported'; transactionId: string }>
  | Readonly<{ disposition: 'duplicate' }>;

export class ImportPluggyTransaction {
  constructor(
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountState: TransactionAccountImportEligibilityReader,
  ) {}

  async execute(
    context: TenantContext,
    input: ImportPluggyTransactionInput,
    requestId: string = randomUUID(),
  ): Promise<ImportPluggyTransactionResult> {
    assertTenantContext(context);
    if (
      !isCanonicalUuid(input.accountId) ||
      !isCanonicalUuid(input.connectionId) ||
      !isCanonicalUuid(input.providerAccountId) ||
      !isCanonicalUuid(input.providerTransactionId)
    ) {
      throw new InvalidTransactionRequest('Invalid Pluggy import identity.');
    }

    const accountState = await this.accountState.getOwnedImportAvailability(
      context,
      input.accountId,
    );
    if (accountState === 'missing') throw new TransactionAccountNotFound();
    if (accountState.startsWith('archived_')) {
      throw new TransactionAccountArchived();
    }

    const amount = Math.abs(Number(input.amount));
    if (!Number.isFinite(amount)) {
      throw new InvalidTransactionRequest('Invalid Pluggy transaction amount.');
    }
    const transaction = Transaction.createImported({
      tenantId: context.tenantId,
      accountId: input.accountId.toLowerCase(),
      type: input.type,
      amount: String(amount),
      occurredOn: input.occurredOn,
      description: input.description,
      externalIdentityKey: createPluggyExternalIdentityKey(input),
    });

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

function createPluggyExternalIdentityKey(
  input: ImportPluggyTransactionInput,
): string {
  return createHash('sha256')
    .update(
      `${input.connectionId.toLowerCase()}\0${input.providerAccountId.toLowerCase()}\0${input.providerTransactionId.toLowerCase()}`,
      'utf8',
    )
    .digest('hex');
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
