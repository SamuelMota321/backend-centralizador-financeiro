import { InvalidTransactionType } from './transactions.errors.js';

const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export function parseTransactionType(value: string): TransactionType {
  if ((TRANSACTION_TYPES as readonly string[]).includes(value)) {
    return value as TransactionType;
  }
  throw new InvalidTransactionType(`Unsupported transaction type: ${value}.`);
}
