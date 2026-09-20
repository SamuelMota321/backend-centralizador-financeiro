import { InvalidTransactionDate } from './transactions.errors.js';

export type CivilDate = string;

export function parseCivilDate(value: string): CivilDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidTransactionDate(
      'Transaction date must use the YYYY-MM-DD format.',
    );
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new InvalidTransactionDate(
      'Transaction date must be a real civil date.',
    );
  }
  return value;
}

export function parseDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidTransactionDate(
      'Timestamp must be a valid ISO date-time.',
    );
  }
  return value;
}
