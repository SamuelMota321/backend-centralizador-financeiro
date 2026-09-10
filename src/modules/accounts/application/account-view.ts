import type { AccountOrigin } from '../domain/account.js';
import type { AccountType } from '../domain/account-type.js';

export type AccountView = Readonly<{
  id: string;
  name: string;
  type: AccountType;
  origin: AccountOrigin;
  institutionName: string | null;
  initialBalance: string;
  initialBalanceAsOf: string;
  currencyCode: 'BRL';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type DuplicateCandidate = Pick<
  AccountView,
  'id' | 'name' | 'type' | 'origin' | 'institutionName'
>;

export type AccountPage = Readonly<{
  items: AccountView[];
  page: number;
  pageSize: number;
  total: number;
}>;
