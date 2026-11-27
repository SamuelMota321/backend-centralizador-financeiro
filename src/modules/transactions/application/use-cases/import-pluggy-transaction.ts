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

import {
  categorizeWithRules,
  toEvaluableRules,
} from './categorize-with-active-rules.js';

export type ImportPluggyTransactionInput = Readonly<{
  connectionId: string;
  accountId: string;
  providerAccountId: string;
  providerTransactionId: string | null;
  currencyCode: string;
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description: string | null;
}>;

export type ImportPluggyTransactionResult =
  | Readonly<{ disposition: 'imported'; transactionId: string }>
  | Readonly<{ disposition: 'duplicate' | 'ambiguous' }>;

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
      (input.providerTransactionId !== null &&
        !isCanonicalUuid(input.providerTransactionId)) ||
      !/^[A-Z]{3}$/.test(input.currencyCode)
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
      if (input.providerTransactionId === null) {
        const matches = await scope.transactions.countFallbackCandidates({
          accountId: input.accountId.toLowerCase(),
          type: input.type,
          amount: String(amount),
          occurredOn: input.occurredOn,
          description: input.description,
        });
        if (matches > 1) return { disposition: 'ambiguous' };
        if (matches === 1) return { disposition: 'duplicate' };
      }
      const rules = toEvaluableRules(
        await scope.categoryRules.findActiveForEvaluation(),
      );
      const snapshot = await scope.transactions.createIfExternalIdentityAbsent(
        categorizeWithRules(rules, transaction),
      );
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
  const identity = input.providerTransactionId
    ? input.providerTransactionId.toLowerCase()
    : `${input.currencyCode}\0${input.occurredOn}\0${Math.abs(Number(input.amount))}\0${input.type}\0${input.description ?? ''}`;
  return createHash('sha256')
    .update(
      `${input.connectionId.toLowerCase()}\0${input.providerAccountId.toLowerCase()}\0${identity}`,
      'utf8',
    )
    .digest('hex');
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
