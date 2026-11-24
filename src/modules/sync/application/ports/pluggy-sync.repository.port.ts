import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  PluggyAccountSnapshot,
  PluggyInvestmentMovementSnapshot,
  PluggyInvestmentSnapshot,
} from '../../../accounts/application/ports/pluggy-provider.port.js';
import type { SyncReason, SyncRun, SyncTarget } from '../pluggy-sync.types.js';

export const PLUGGY_SYNC_REPOSITORY = Symbol('PLUGGY_SYNC_REPOSITORY');

export interface PluggySyncRepository {
  createManual(
    context: TenantContext,
    connectionId: string,
  ): Promise<{ run: SyncRun; created: boolean }>;
  createDaily(target: SyncTarget, civilDate: string): Promise<SyncRun | null>;
  findOwned(
    context: TenantContext,
    connectionId: string,
    runId: string,
  ): Promise<SyncRun | null>;
  latestOwned(
    context: TenantContext,
    connectionId: string,
  ): Promise<{ latest: SyncRun | null; lastReconciled: SyncRun | null } | null>;
  findJob(context: TenantContext, runId: string): Promise<SyncRun | null>;
  claim(context: TenantContext, runId: string): Promise<boolean>;
  releaseRetry(context: TenantContext, runId: string): Promise<void>;
  markUpdateRequested(context: TenantContext, runId: string): Promise<void>;
  finish(
    context: TenantContext,
    runId: string,
    status: 'action_required' | 'succeeded' | 'partial' | 'failed',
    reasons: readonly SyncReason[],
    referenceDate: Date | null,
    collection?: Readonly<{
      investmentsComplete: boolean;
      movementsComplete: boolean;
      investments: readonly Readonly<{
        investment: PluggyInvestmentSnapshot;
        movements: readonly PluggyInvestmentMovementSnapshot[];
      }>[];
    }>,
  ): Promise<void>;
  listDailyTargets(): Promise<readonly SyncTarget[]>;
  pruneExpiredRuns(): Promise<number>;
  saveAccount(
    context: TenantContext,
    connectionId: string,
    account: PluggyAccountSnapshot,
    referenceDate: Date,
  ): Promise<void>;
  mappedAccounts(
    context: TenantContext,
    connectionId: string,
  ): Promise<ReadonlyMap<string, string>>;
}
