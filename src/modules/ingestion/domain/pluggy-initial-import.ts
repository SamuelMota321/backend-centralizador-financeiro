export type PluggyInitialImportStatus =
  | 'queued'
  | 'processing'
  | 'awaiting_account_mapping'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type PluggyDataAvailability =
  'pending' | 'available' | 'unavailable' | 'failed';

export type PluggyAccountMappingStatus = 'pending' | 'mapped' | 'unsupported';

export type PluggyInitialImportAccount = Readonly<{
  providerAccountId: string;
  name: string;
  accountType: 'checking' | 'savings' | 'credit_card' | null;
  currencyCode: string;
  mappingStatus: PluggyAccountMappingStatus;
  errorCode: string | null;
  mappedAccountId: string | null;
  balance: string | null;
  balanceAsOf: string | null;
}>;

export type PluggyInitialImportAccountView = Omit<
  PluggyInitialImportAccount,
  'balance' | 'balanceAsOf'
>;

export type PluggyInitialImportRun = Readonly<{
  id: string;
  connectionId: string;
  status: PluggyInitialImportStatus;
  accountsAvailability: PluggyDataAvailability;
  transactionsAvailability: PluggyDataAvailability;
  accountsErrorCode: string | null;
  transactionsErrorCode: string | null;
  totalAccounts: number;
  mappedAccounts: number;
  totalTransactions: number;
  importedTransactions: number;
  ignoredTransactions: number;
  failedTransactions: number;
  terminalAt: string | null;
  retentionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type PluggyInitialImportDetails = Readonly<{
  run: PluggyInitialImportRun;
  accounts: readonly PluggyInitialImportAccount[];
}>;

export type PluggyInitialImportView = Readonly<{
  id: string;
  status: PluggyInitialImportStatus;
  availability: Readonly<{
    accounts: Readonly<{
      status: PluggyDataAvailability;
      errorCode: string | null;
    }>;
    transactions: Readonly<{
      status: PluggyDataAvailability;
      errorCode: string | null;
    }>;
  }>;
  accountMapping: Readonly<{
    total: number;
    mapped: number;
    accounts: readonly PluggyInitialImportAccountView[];
  }>;
  transactions: Readonly<{
    total: number;
    imported: number;
    ignored: number;
    failed: number;
  }>;
  terminalAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export function toPluggyInitialImportView(
  details: PluggyInitialImportDetails,
): PluggyInitialImportView {
  const { run, accounts } = details;
  return {
    id: run.id,
    status: run.status,
    availability: {
      accounts: {
        status: run.accountsAvailability,
        errorCode: run.accountsErrorCode,
      },
      transactions: {
        status: run.transactionsAvailability,
        errorCode: run.transactionsErrorCode,
      },
    },
    accountMapping: {
      total: run.totalAccounts,
      mapped: run.mappedAccounts,
      accounts: accounts.map((account) => ({
        providerAccountId: account.providerAccountId,
        name: account.name,
        accountType: account.accountType,
        currencyCode: account.currencyCode,
        mappingStatus: account.mappingStatus,
        errorCode: account.errorCode,
        mappedAccountId: account.mappedAccountId,
      })),
    },
    transactions: {
      total: run.totalTransactions,
      imported: run.importedTransactions,
      ignored: run.ignoredTransactions,
      failed: run.failedTransactions,
    },
    terminalAt: run.terminalAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
