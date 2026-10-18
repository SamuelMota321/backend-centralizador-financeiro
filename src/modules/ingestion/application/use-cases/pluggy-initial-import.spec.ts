import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  PluggyAccountSnapshot,
  PluggyProvider,
  PluggyTransactionSnapshot,
} from '../../../accounts/application/ports/pluggy-provider.port.js';
import type { ConnectionsCollectionEligibility } from '../../../accounts/application/ports/connections.repository.port.js';
import type {
  AssociatePluggyAccount,
  CreatePluggyConnectedAccount,
} from '../../../accounts/application/use-cases/pluggy-account-mapping.js';
import type { PluggyConnectionLifecycle } from '../../../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import { PluggyUnavailable } from '../../../accounts/adapters/outbound/pluggy-api.client.js';
import type { QStashPluggyWebhookService } from '../../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import type { ImportPluggyTransaction } from '../../../transactions/application/use-cases/import-pluggy-transaction.js';
import type {
  PluggyInitialImportRepository,
  PluggyImportAccountInput,
} from '../ports/pluggy-initial-import.repository.port.js';
import type {
  PluggyDataAvailability,
  PluggyInitialImportAccount,
  PluggyInitialImportDetails,
  PluggyInitialImportRun,
} from '../../domain/pluggy-initial-import.js';
import { PluggyInitialImport } from './pluggy-initial-import.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const connectionId = '164aa078-983d-4c39-aae4-dda44b495970';
const runId = '264aa078-983d-4f3d-a28e-fb5575ddc3ee';
const itemId = '364aa078-983d-4f3d-a28e-fb5575ddc3ee';
const localAccountId = '464aa078-983d-4f3d-a28e-fb5575ddc3ee';
const now = new Date('2026-10-10T12:00:00.000Z');

function run(status: PluggyInitialImportRun['status']): PluggyInitialImportRun {
  return {
    id: runId,
    connectionId,
    status,
    accountsAvailability: 'pending',
    transactionsAvailability: 'pending',
    accountsErrorCode: null,
    transactionsErrorCode: null,
    totalAccounts: 0,
    mappedAccounts: 0,
    totalTransactions: 0,
    importedTransactions: 0,
    ignoredTransactions: 0,
    failedTransactions: 0,
    terminalAt: null,
    retentionExpiresAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function makeMappedAccount(
  input: PluggyImportAccountInput,
  mapped: boolean,
): PluggyInitialImportAccount {
  return {
    ...input,
    mappingStatus: input.errorCode
      ? 'unsupported'
      : mapped
        ? 'mapped'
        : 'pending',
    mappedAccountId: mapped ? localAccountId : null,
  };
}

function providerAccount(
  overrides: Partial<PluggyAccountSnapshot> = {},
): PluggyAccountSnapshot {
  return {
    id: '764aa078-983d-4f3d-a28e-fb5575ddc3ee',
    name: 'Conta sintética',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    balance: '120.00',
    currencyCode: 'BRL',
    ...overrides,
  };
}

function createHarness(options: {
  products: readonly string[];
  providerAccounts: readonly PluggyAccountSnapshot[];
  canStartCollection?: boolean;
  mapped?: boolean;
  listTransactionsImpl?: PluggyProvider['listTransactions'];
}) {
  let currentDetails: PluggyInitialImportDetails = {
    run: run('queued'),
    accounts: [],
  };
  const recordAccounts = vi.fn(
    (
      _tenant: TenantContext,
      _runId: string,
      inputs: readonly PluggyImportAccountInput[],
      availability: PluggyDataAvailability,
      errorCode: string | null,
    ): Promise<PluggyInitialImportDetails> => {
      const accounts = inputs.map((input) =>
        makeMappedAccount(input, options.mapped ?? false),
      );
      const hasPendingMapping = accounts.some(
        (account) => account.mappingStatus === 'pending',
      );
      currentDetails = {
        run: {
          ...currentDetails.run,
          status: hasPendingMapping ? 'awaiting_account_mapping' : 'processing',
          accountsAvailability: availability,
          accountsErrorCode: errorCode,
          totalAccounts: accounts.length,
          mappedAccounts: accounts.filter(
            (account) => account.mappingStatus === 'mapped',
          ).length,
        },
        accounts,
      };
      return Promise.resolve(currentDetails);
    },
  );
  const repository: PluggyInitialImportRepository = {
    reserveStart: () => Promise.resolve({ claimId: null, replayRunId: null }),
    releaseStart: () => Promise.resolve(),
    completeStart: () => Promise.resolve(currentDetails),
    findById: () => Promise.resolve(currentDetails),
    findByConnection: () => Promise.resolve(currentDetails),
    requeueFailed: () => Promise.resolve(currentDetails.run),
    claimWork: () => {
      currentDetails = {
        ...currentDetails,
        run: { ...currentDetails.run, status: 'processing' },
      };
      return Promise.resolve('claimed');
    },
    recordAccounts,
    recordMapping: () =>
      Promise.resolve({
        details: currentDetails,
        shouldQueueTransactions: false,
      }),
    finishTransactions: (
      _tenant,
      _runId,
      availability,
      errorCode,
      counts,
      at,
    ) => {
      currentDetails = {
        ...currentDetails,
        run: {
          ...currentDetails.run,
          status: 'completed',
          transactionsAvailability: availability,
          transactionsErrorCode: errorCode,
          ...counts,
          terminalAt: at.toISOString(),
        },
      };
      return Promise.resolve(currentDetails);
    },
    finishWithoutTransactions: (_tenant, _runId, availability, at) => {
      currentDetails = {
        ...currentDetails,
        run: {
          ...currentDetails.run,
          status: 'completed',
          transactionsAvailability: availability,
          terminalAt: at.toISOString(),
        },
      };
      return Promise.resolve(currentDetails);
    },
    finishAccountFailure: (_tenant, _runId, errorCode, at) => {
      currentDetails = {
        ...currentDetails,
        run: {
          ...currentDetails.run,
          status: 'failed',
          accountsAvailability: 'failed',
          accountsErrorCode: errorCode,
          terminalAt: at.toISOString(),
        },
      };
      return Promise.resolve(currentDetails);
    },
  };
  const connection = {
    id: connectionId,
    provider: 'pluggy',
    status: 'connected',
    consent: {
      id: '664aa078-983d-4f3d-a28e-fb5575ddc3ee',
      status: 'granted',
      products: options.products,
      openFinancePermissionsGranted: [],
      grantedAt: now.toISOString(),
      expiresAt: null,
      revokedAt: null,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const lifecycle = {
    get: vi.fn(() => Promise.resolve(connection)),
    getCollectionReference: vi.fn(() =>
      Promise.resolve({
        providerItemId: itemId,
        consentProducts: options.products,
        openFinancePermissionsGranted: [],
      }),
    ),
  } as unknown as PluggyConnectionLifecycle;
  const listAccounts = vi.fn(() =>
    Promise.resolve({
      accounts: options.providerAccounts,
      totalPages: 1,
    }),
  );
  const listTransactions = vi.fn(
    options.listTransactionsImpl ??
      (() =>
        Promise.resolve({
          transactions: [],
          next: null,
        })),
  );
  const importTransactionExecute = vi.fn(() =>
    Promise.resolve({
      disposition: 'imported' as const,
      transactionId: 'a64aa078-983d-4f3d-a28e-fb5575ddc3ee',
    }),
  );
  const provider: PluggyProvider = {
    createConnectToken: () =>
      Promise.resolve({
        accessToken: 'synthetic-token',
        expiresAt: now,
      }),
    getItem: () => Promise.resolve(null),
    listConsents: () => Promise.resolve([]),
    listAccounts,
    listTransactions,
    deleteItem: () => Promise.resolve(),
  };
  const eligibility: ConnectionsCollectionEligibility = {
    canStartCollection: () =>
      Promise.resolve(options.canStartCollection ?? true),
  };
  const queue = {
    publishInitialImport: vi.fn(() => Promise.resolve()),
  } as unknown as QStashPluggyWebhookService;
  const initialImport = new PluggyInitialImport(
    repository,
    lifecycle,
    eligibility,
    provider,
    {} as CreatePluggyConnectedAccount,
    {} as AssociatePluggyAccount,
    { execute: importTransactionExecute } as unknown as ImportPluggyTransaction,
    queue,
    () => now,
  );

  return {
    initialImport,
    listAccounts,
    listTransactions,
    importTransactionExecute,
    recordAccounts,
    get details() {
      return currentDetails;
    },
  };
}

describe('Pluggy initial import', () => {
  it('does not persist investment accounts returned with account metadata', async () => {
    const bankAccount = providerAccount();
    const investmentAccount = providerAccount({
      id: '864aa078-983d-4f3d-a28e-fb5575ddc3ee',
      type: 'INVESTMENT',
      subtype: 'BROKERAGE',
      name: 'Conta de investimento sintética',
    });
    const harness = createHarness({
      products: ['ACCOUNTS', 'TRANSACTIONS'],
      providerAccounts: [bankAccount, investmentAccount],
    });

    await harness.initialImport.processJob({
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    });

    expect(harness.listAccounts).toHaveBeenCalledWith(itemId, 1);
    expect(
      harness.recordAccounts.mock.calls[0]?.[2].map(
        (account) => account.providerAccountId,
      ),
    ).toEqual([bankAccount.id]);
    expect(harness.listTransactions).not.toHaveBeenCalled();
  });

  it('does not request transactions unless the TRANSACTIONS product is consented', async () => {
    const creditAccount = providerAccount({
      id: '964aa078-983d-4f3d-a28e-fb5575ddc3ee',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Cartão sintético',
    });
    const harness = createHarness({
      products: ['CREDIT_CARDS'],
      providerAccounts: [creditAccount],
      mapped: true,
    });

    await harness.initialImport.processJob({
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    });

    expect(harness.listAccounts).toHaveBeenCalledOnce();
    expect(harness.listTransactions).not.toHaveBeenCalled();
    expect(harness.details.run.transactionsAvailability).toBe('unavailable');
  });

  it('does not start a provider request after collection eligibility is lost', async () => {
    const harness = createHarness({
      products: ['ACCOUNTS', 'TRANSACTIONS'],
      providerAccounts: [providerAccount()],
      canStartCollection: false,
    });

    await harness.initialImport.processJob({
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    });

    expect(harness.listAccounts).not.toHaveBeenCalled();
  });

  it('keeps transactions imported before a later provider page fails', async () => {
    const account = providerAccount();
    const transaction: PluggyTransactionSnapshot = {
      id: 'a74aa078-983d-4f3d-a28e-fb5575ddc3ee',
      accountId: account.id,
      amount: '25.90',
      date: '2026-10-09T11:00:00.000Z',
      description: 'Compra sintética',
      type: 'DEBIT',
      status: 'POSTED',
      currencyCode: 'BRL',
    };
    let page = 0;
    const listTransactionsImpl: PluggyProvider['listTransactions'] = () => {
      page += 1;
      return page === 1
        ? Promise.resolve({
            transactions: [transaction],
            next: '?cursor=synthetic-next-page',
          })
        : Promise.reject(new PluggyUnavailable());
    };
    const harness = createHarness({
      products: ['ACCOUNTS', 'TRANSACTIONS'],
      providerAccounts: [account],
      mapped: true,
      listTransactionsImpl,
    });

    await harness.initialImport.processJob({
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    });

    expect(harness.importTransactionExecute).toHaveBeenCalledOnce();
    expect(harness.listTransactions).toHaveBeenCalledTimes(2);
    expect(harness.details.run.importedTransactions).toBe(1);
    expect(harness.details.run.transactionsAvailability).toBe('failed');
  });
});
