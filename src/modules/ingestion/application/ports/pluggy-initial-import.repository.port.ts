import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  PluggyDataAvailability,
  PluggyInitialImportDetails,
  PluggyInitialImportRun,
} from '../../domain/pluggy-initial-import.js';

export const PLUGGY_INITIAL_IMPORT_REPOSITORY = Symbol(
  'PLUGGY_INITIAL_IMPORT_REPOSITORY',
);

export type PluggyImportAccountInput = Readonly<{
  providerAccountId: string;
  name: string;
  accountType: 'checking' | 'savings' | 'credit_card' | null;
  currencyCode: string;
  balance: string | null;
  balanceAsOf: string | null;
  errorCode: string | null;
}>;

export type PluggyImportCounts = Readonly<{
  totalTransactions: number;
  importedTransactions: number;
  ignoredTransactions: number;
  failedTransactions: number;
}>;

export type IdempotencyReservation = Readonly<{
  claimId: string | null;
  replayRunId: string | null;
}>;

export type MappingResult = Readonly<{
  details: PluggyInitialImportDetails;
  shouldQueueTransactions: boolean;
}>;

export interface PluggyInitialImportRepository {
  reserveStart(
    context: TenantContext,
    idempotencyKey: string,
    payloadHash: string,
    now: Date,
  ): Promise<IdempotencyReservation>;
  releaseStart(context: TenantContext, claimId: string): Promise<void>;
  completeStart(
    context: TenantContext,
    connectionId: string,
    claimId: string,
  ): Promise<PluggyInitialImportDetails>;
  findById(
    context: TenantContext,
    runId: string,
  ): Promise<PluggyInitialImportDetails | null>;
  findByConnection(
    context: TenantContext,
    connectionId: string,
  ): Promise<PluggyInitialImportDetails | null>;
  requeueFailed(
    context: TenantContext,
    runId: string,
  ): Promise<PluggyInitialImportRun>;
  claimWork(
    context: TenantContext,
    runId: string,
  ): Promise<'claimed' | 'busy' | 'not_queued'>;
  recordAccounts(
    context: TenantContext,
    runId: string,
    accounts: readonly PluggyImportAccountInput[],
    availability: PluggyDataAvailability,
    errorCode: string | null,
  ): Promise<PluggyInitialImportDetails>;
  recordMapping(
    context: TenantContext,
    runId: string,
    providerAccountId: string,
    mappedAccountId: string,
  ): Promise<MappingResult>;
  finishTransactions(
    context: TenantContext,
    runId: string,
    availability: PluggyDataAvailability,
    errorCode: string | null,
    counts: PluggyImportCounts,
    now: Date,
  ): Promise<PluggyInitialImportDetails>;
  finishWithoutTransactions(
    context: TenantContext,
    runId: string,
    availability: PluggyDataAvailability,
    now: Date,
  ): Promise<PluggyInitialImportDetails>;
  finishAccountFailure(
    context: TenantContext,
    runId: string,
    errorCode: string,
    now: Date,
  ): Promise<PluggyInitialImportDetails>;
}
