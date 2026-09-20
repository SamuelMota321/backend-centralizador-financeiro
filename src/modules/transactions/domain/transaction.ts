import { parseCivilDate, parseDateTime, type CivilDate } from './civil-date.js';
import { TransactionAmount } from './transaction-amount.js';
import {
  parseTransactionType,
  type TransactionType,
} from './transaction-type.js';
import {
  InvalidTransactionState,
  TransactionCategorizationNotAllowed,
} from './transactions.errors.js';

export type TransactionStatus = 'posted' | 'voided';
export type TransferSide = 'outgoing' | 'incoming';
export type CategorizationStatus =
  | 'unclassified'
  | 'categorized'
  | 'uncertain'
  | 'unrecognized'
  | 'not_applicable';
export type CategorizationSource = 'manual' | 'rule';

export type TransactionProps = Readonly<{
  tenantId: string;
  accountId: string;
  type: TransactionType;
  amount: TransactionAmount;
  occurredOn: CivilDate;
  description: string | null;
  status: TransactionStatus;
  transferId: string | null;
  transferSide: TransferSide | null;
  categoryId: string | null;
  categorizationStatus: CategorizationStatus;
  categorizationSource: CategorizationSource | null;
}>;

export type TransactionSnapshot = Readonly<{
  id: string;
  tenantId: string;
  accountId: string;
  type: TransactionType;
  amount: string;
  occurredOn: CivilDate;
  description: string | null;
  status: TransactionStatus;
  transferId: string | null;
  transferSide: TransferSide | null;
  categoryId: string | null;
  categorizationStatus: CategorizationStatus;
  categorizationSource: CategorizationSource | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateManualTransactionInput = Readonly<{
  tenantId: string;
  accountId: string;
  type: string;
  amount: string;
  occurredOn: string;
  description?: string | null;
}>;

export type CreateTransferEntryInput = Readonly<{
  tenantId: string;
  accountId: string;
  amount: string;
  occurredOn: string;
  description?: string | null;
  transferId: string;
  transferSide: TransferSide;
}>;

export class Transaction {
  private constructor(
    readonly props: TransactionProps,
    readonly snapshot: TransactionSnapshot | null = null,
  ) {}

  static createManual(input: CreateManualTransactionInput): Transaction {
    const type = parseTransactionType(input.type);
    if (type === 'transfer') {
      throw new InvalidTransactionState(
        'Transfer entries must be created as a related pair.',
      );
    }

    return new Transaction({
      tenantId: input.tenantId,
      accountId: input.accountId,
      type,
      amount: TransactionAmount.fromDecimal(input.amount),
      occurredOn: parseCivilDate(input.occurredOn),
      description: normalizeDescription(input.description),
      status: 'posted',
      transferId: null,
      transferSide: null,
      categoryId: null,
      categorizationStatus: 'unclassified',
      categorizationSource: null,
    });
  }

  static createTransferEntry(input: CreateTransferEntryInput): Transaction {
    return new Transaction({
      tenantId: input.tenantId,
      accountId: input.accountId,
      type: 'transfer',
      amount: TransactionAmount.fromDecimal(input.amount),
      occurredOn: parseCivilDate(input.occurredOn),
      description: normalizeDescription(input.description),
      status: 'posted',
      transferId: input.transferId,
      transferSide: input.transferSide,
      categoryId: null,
      categorizationStatus: 'not_applicable',
      categorizationSource: null,
    });
  }

  static reconstitute(input: TransactionSnapshot): Transaction {
    const transaction = new Transaction(
      {
        tenantId: input.tenantId,
        accountId: input.accountId,
        type: parseTransactionType(input.type),
        amount: TransactionAmount.fromDecimal(input.amount),
        occurredOn: parseCivilDate(input.occurredOn),
        description: normalizeDescription(input.description),
        status: input.status,
        transferId: input.transferId,
        transferSide: input.transferSide,
        categoryId: input.categoryId,
        categorizationStatus: input.categorizationStatus,
        categorizationSource: input.categorizationSource,
      },
      {
        ...input,
        occurredOn: parseCivilDate(input.occurredOn),
        createdAt: parseDateTime(input.createdAt),
        updatedAt: parseDateTime(input.updatedAt),
      },
    );
    transaction.assertInvariants();
    return transaction;
  }

  categorize(
    categoryId: string,
    source: CategorizationSource,
    updatedAt: string,
  ): Transaction {
    if (this.props.type === 'transfer' || this.props.status === 'voided') {
      throw new TransactionCategorizationNotAllowed(
        'Only posted income and expense transactions can be categorized.',
      );
    }
    if (!categoryId) {
      throw new TransactionCategorizationNotAllowed(
        'A category is required for categorization.',
      );
    }

    return new Transaction(
      {
        ...this.props,
        categoryId,
        categorizationStatus: 'categorized',
        categorizationSource: source,
      },
      this.snapshot
        ? {
            ...this.snapshot,
            categoryId,
            categorizationStatus: 'categorized',
            categorizationSource: source,
            updatedAt: parseDateTime(updatedAt),
          }
        : null,
    );
  }

  void(updatedAt: string): Transaction {
    if (this.props.status === 'voided') {
      return this;
    }
    return new Transaction(
      { ...this.props, status: 'voided' },
      this.snapshot
        ? {
            ...this.snapshot,
            status: 'voided',
            updatedAt: parseDateTime(updatedAt),
          }
        : null,
    );
  }

  private assertInvariants(): void {
    const isTransfer = this.props.type === 'transfer';
    if (
      isTransfer !==
      (this.props.transferId !== null && this.props.transferSide !== null)
    ) {
      throw new InvalidTransactionState(
        'Transfer type and transfer relation must agree.',
      );
    }
    if (
      !isTransfer &&
      (this.props.transferId !== null || this.props.transferSide !== null)
    ) {
      throw new InvalidTransactionState(
        'Income and expense transactions cannot have transfer fields.',
      );
    }

    if (isTransfer) {
      if (
        this.props.categoryId !== null ||
        this.props.categorizationSource !== null ||
        this.props.categorizationStatus !== 'not_applicable'
      ) {
        throw new InvalidTransactionState(
          'Transfer entries cannot have a category.',
        );
      }
      return;
    }

    if (this.props.categoryId === null) {
      if (
        this.props.categorizationStatus === 'categorized' ||
        this.props.categorizationSource !== null
      ) {
        throw new InvalidTransactionState(
          'A categorized transaction requires a category and source.',
        );
      }
      return;
    }

    if (
      this.props.categorizationStatus !== 'categorized' ||
      this.props.categorizationSource === null
    ) {
      throw new InvalidTransactionState(
        'A transaction with a category must be categorized with a source.',
      );
    }
  }
}

function normalizeDescription(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
  return normalized === '' ? null : normalized;
}
