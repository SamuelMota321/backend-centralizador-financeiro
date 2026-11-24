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
  products?: readonly string[];
  unavailableProducts?: readonly string[];
  lastUpdatedAt?: Date | null;
  userAction?: string | null;
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
  id: string | null;
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

export type PluggyInvestmentSnapshot = Readonly<{
  id: string;
  name: string;
  type: string;
  status: string | null;
  subtype: string | null;
  balance: string;
  currencyCode: string | null;
  quantity: string | null;
  amount: string | null;
  amountOriginal: string | null;
  amountProfit: string | null;
  institutionName: string | null;
  rate: string | null;
  rateType: string | null;
  fixedAnnualRate: string | null;
  maturityDate: string | null;
  date: string | null;
}>;

export type PluggyInvestmentMovementSnapshot = Readonly<{
  id: string;
  type: string;
  amount: string | null;
  date: string;
}>;

export type PluggyInvestmentsPage = Readonly<{
  investments: readonly PluggyInvestmentSnapshot[];
  totalPages: number;
}>;

export type PluggyInvestmentMovementsPage = Readonly<{
  movements: readonly PluggyInvestmentMovementSnapshot[];
  totalPages: number;
}>;

export interface PluggyProvider {
  createConnectToken(
    clientUserId: string,
    itemId?: string,
  ): Promise<PluggyConnectToken>;
  getItem(itemId: string): Promise<PluggyItemSnapshot | null>;
  updateItem(itemId: string): Promise<PluggyItemSnapshot>;
  listConsents(itemId: string): Promise<readonly PluggyConsentSnapshot[]>;
  listAccounts(itemId: string, page: number): Promise<PluggyAccountsPage>;
  listTransactions(
    accountId: string,
    next: string | null,
  ): Promise<PluggyTransactionsPage>;
  listInvestments(itemId: string, page: number): Promise<PluggyInvestmentsPage>;
  listInvestmentMovements(
    investmentId: string,
    page: number,
  ): Promise<PluggyInvestmentMovementsPage>;
  deleteItem(itemId: string): Promise<void>;
}
