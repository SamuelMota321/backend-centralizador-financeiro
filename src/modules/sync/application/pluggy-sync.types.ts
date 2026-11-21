export type SyncStatus =
  'queued' | 'running' | 'action_required' | 'succeeded' | 'partial' | 'failed';

export type SyncReason = Readonly<{
  dataType:
    | 'accounts'
    | 'transactions'
    | 'investments'
    | 'investment_transactions'
    | 'connection';
  code: 'unavailable' | 'failed' | 'ambiguous_identity';
}>;

export type SyncRun = Readonly<{
  id: string;
  tenantId: string;
  connectionId: string;
  ownerUserId: string;
  trigger: 'manual' | 'daily';
  status: SyncStatus;
  reasons: readonly SyncReason[];
  acceptedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  referenceDate: Date | null;
  updateRequestedAt: Date | null;
}>;

export type SyncJob = Readonly<{
  runId: string;
  tenantId: string;
  userId: string;
}>;
export type SyncTarget = Readonly<{
  tenantId: string;
  userId: string;
  connectionId: string;
}>;

export type SyncRunView = Readonly<{
  runId: string;
  connectionId: string;
  status: SyncStatus;
  trigger: 'manual' | 'daily';
  acceptedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  referenceDate: string | null;
  reasons: readonly SyncReason[];
  statusUrl: string;
}>;

export function toSyncRunView(run: SyncRun): SyncRunView {
  return {
    runId: run.id,
    connectionId: run.connectionId,
    status: run.status,
    trigger: run.trigger,
    acceptedAt: run.acceptedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    referenceDate: run.referenceDate?.toISOString() ?? null,
    reasons: run.reasons,
    statusUrl: `/api/v1/connections/${run.connectionId}/sync-runs/${run.id}`,
  };
}
