export const PLUGGY_PROVIDER = Symbol('PLUGGY_PROVIDER');

export type PluggyConnectToken = Readonly<{
  accessToken: string;
  expiresAt: Date;
}>;

export type PluggyItemSnapshot = Readonly<{
  id: string;
  clientUserId: string | null;
  status: string;
  executionStatus: string;
}>;

export type PluggyConsentSnapshot = Readonly<{
  id: string;
  itemId: string;
  products: readonly string[];
  openFinancePermissionsGranted: readonly string[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}>;

export type PluggyWebhookEvent = Readonly<{
  event: string;
  eventId: string;
  itemId: string;
  clientUserId: string;
}>;

export type PluggyAccountSnapshot = Readonly<{
  id: string;
  name: string;
  type: string;
  subtype: string;
  balance: string;
  currencyCode: string;
}>;

export type PluggyTransactionSnapshot = Readonly<{
  id: string;
  accountId: string;
  amount: string;
  date: string;
  description: string | null;
  type: 'CREDIT' | 'DEBIT';
  status: string;
  currencyCode: string;
}>;

export type PluggyAccountsPage = Readonly<{
  accounts: readonly PluggyAccountSnapshot[];
  totalPages: number;
}>;

export type PluggyTransactionsPage = Readonly<{
  transactions: readonly PluggyTransactionSnapshot[];
  next: string | null;
}>;

export interface PluggyProvider {
  createConnectToken(clientUserId: string): Promise<PluggyConnectToken>;
  getItem(itemId: string): Promise<PluggyItemSnapshot | null>;
  listConsents(itemId: string): Promise<readonly PluggyConsentSnapshot[]>;
  listAccounts(itemId: string, page: number): Promise<PluggyAccountsPage>;
  listTransactions(
    accountId: string,
    next: string | null,
  ): Promise<PluggyTransactionsPage>;
  deleteItem(itemId: string): Promise<void>;
}
