import { InvalidAccountType } from './account.errors.js';

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'payment',
  'cash',
  'credit_card',
  'investment',
  'other',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export function parseAccountType(value: string): AccountType {
  if (!ACCOUNT_TYPES.some((type) => type === value)) {
    throw new InvalidAccountType(`Unsupported account type: ${value}`);
  }
  return value as AccountType;
}
