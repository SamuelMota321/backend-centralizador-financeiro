import { createHash } from 'node:crypto';
import { TransactionAmount } from '../domain/transaction-amount.js';
import { parseCivilDate } from '../domain/civil-date.js';
import { InvalidTransactionRequest } from './transactions.errors.js';

export type OfxTransactionIdentityInput = Readonly<{
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description: string | null;
  externalId: string | null;
}>;

export function createOfxExternalIdentityKey(
  input: OfxTransactionIdentityInput,
): string {
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
