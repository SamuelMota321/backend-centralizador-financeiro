import { describe, expect, it, vi } from 'vitest';
import type {
  PluggyItemSnapshot,
  PluggyProvider,
} from '../../accounts/application/ports/pluggy-provider.port.js';
import type { PluggyConnectionLifecycle } from '../../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import type { QStashPluggyWebhookService } from '../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import { PluggyUnavailable } from '../../accounts/adapters/outbound/pluggy-api.client.js';
import type { ImportPluggyTransaction } from '../../transactions/application/use-cases/import-pluggy-transaction.js';
import type { PluggySyncRepository } from './ports/pluggy-sync.repository.port.js';
import type { SyncRun } from './pluggy-sync.types.js';
import { PluggySynchronization } from './pluggy-synchronization.js';

const context = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const connectionId = '164aa078-983d-4f3d-a28e-fb5575ddc3ee';
const runId = '264aa078-983d-4f3d-a28e-fb5575ddc3ee';
const itemId = '364aa078-983d-4f3d-a28e-fb5575ddc3ee';
const now = new Date('2026-11-21T15:00:00.000Z');

function fixture() {
  const run: SyncRun = {
    id: runId,
    tenantId: context.tenantId,
    connectionId,
    ownerUserId: context.userId,
    trigger: 'manual',
    status: 'queued',
    reasons: [],
    acceptedAt: now,
    startedAt: null,
    completedAt: null,
    referenceDate: null,
    updateRequestedAt: null,
  };
  const repository = {
    createManual: vi.fn(() => Promise.resolve({ run, created: true })),
    findJob: vi.fn(() => Promise.resolve(run)),
    claim: vi.fn(() => Promise.resolve(true)),
    markUpdateRequested: vi.fn(() => Promise.resolve()),
    finish: vi.fn(() => Promise.resolve()),
    releaseRetry: vi.fn(() => Promise.resolve()),
    mappedAccounts: vi.fn(() => Promise.resolve(new Map())),
    saveAccount: vi.fn(() => Promise.resolve()),
    saveInvestment: vi.fn(() => Promise.resolve(runId)),
    saveMovement: vi.fn(() => Promise.resolve()),
  };
  const lifecycle = {
    getCollectionReference: vi.fn(() =>
      Promise.resolve({ providerItemId: itemId }),
    ),
    get: vi.fn(() =>
      Promise.resolve({ consent: { products: ['ACCOUNTS', 'TRANSACTIONS'] } }),
    ),
  };
  const eligibility = {
    canStartCollection: vi.fn(() => Promise.resolve(true)),
  };
  const item: PluggyItemSnapshot = {
    id: itemId,
    clientUserId: null,
    status: 'UPDATED',
    executionStatus: 'SUCCESS',
    products: [
      'ACCOUNTS',
      'TRANSACTIONS',
      'INVESTMENTS',
      'INVESTMENTS_TRANSACTIONS',
    ],
    lastUpdatedAt: now,
    userAction: null,
  };
  const provider = {
    getItem: vi.fn(() => Promise.resolve(item)),
    updateItem: vi.fn(() => Promise.resolve(item)),
    listAccounts: vi.fn(() => Promise.resolve({ totalPages: 0, accounts: [] })),
    listInvestments: vi.fn(() =>
      Promise.resolve({ totalPages: 0, investments: [] }),
    ),
  };
  const queue = { publishSync: vi.fn(() => Promise.resolve()) };
  const synchronization = new PluggySynchronization(
    repository as unknown as PluggySyncRepository,
    lifecycle as unknown as PluggyConnectionLifecycle,
    eligibility,
    provider as unknown as PluggyProvider,
    {} as ImportPluggyTransaction,
    queue as unknown as QStashPluggyWebhookService,
    () => now,
  );
  return {
    synchronization,
    repository,
    lifecycle,
    eligibility,
    provider,
    queue,
    run,
  };
}

describe('PluggySynchronization', () => {
  it('publishes a new run once and returns the active run on a repeated manual request', async () => {
    const { synchronization, repository, queue, run } = fixture();
    expect(
      (await synchronization.requestManual(context, connectionId)).runId,
    ).toBe(runId);
    repository.createManual.mockResolvedValue({ run, created: false });
    expect(
      (await synchronization.requestManual(context, connectionId)).runId,
    ).toBe(runId);
    expect(queue.publishSync).toHaveBeenCalledTimes(1);
    expect(queue.publishSync).toHaveBeenCalledWith({
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    });
  });

  it('does not collect investments absent from the active consent even if the Item advertises them', async () => {
    const { synchronization, provider, repository } = fixture();
    await synchronization.processJob(
      { runId, tenantId: context.tenantId, userId: context.userId },
      0,
    );
    expect(provider.listInvestments).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(
      context,
      runId,
      'partial',
      [
        { dataType: 'investments', code: 'unavailable' },
        { dataType: 'investment_transactions', code: 'unavailable' },
      ],
      now,
    );
  });

  it('releases a transient failure and terminates after three retries', async () => {
    const { synchronization, provider, repository } = fixture();
    provider.updateItem.mockRejectedValue(new PluggyUnavailable());
    const job = { runId, tenantId: context.tenantId, userId: context.userId };
    await expect(synchronization.processJob(job, 0)).rejects.toBeInstanceOf(
      PluggyUnavailable,
    );
    expect(repository.releaseRetry).toHaveBeenCalledWith(context, runId);
    await expect(synchronization.processJob(job, 3)).resolves.toBeUndefined();
    expect(repository.finish).toHaveBeenCalledWith(
      context,
      runId,
      'failed',
      [{ dataType: 'connection', code: 'failed' }],
      null,
    );
  });

  it('does not touch the provider when another worker owns the lease', async () => {
    const { synchronization, repository, provider } = fixture();
    repository.claim.mockResolvedValue(false);
    await synchronization.processJob(
      { runId, tenantId: context.tenantId, userId: context.userId },
      0,
    );
    expect(provider.getItem).not.toHaveBeenCalled();
  });

  it('reports action_required before attempting a PATCH when the Item waits for the user', async () => {
    const { synchronization, repository, provider } = fixture();
    provider.getItem.mockResolvedValue({
      id: itemId,
      clientUserId: null,
      status: 'WAITING_USER_ACTION',
      executionStatus: 'WAITING_USER_ACTION',
      products: [],
      lastUpdatedAt: now,
      userAction: 'authorize-access',
    });
    await synchronization.processJob(
      { runId, tenantId: context.tenantId, userId: context.userId },
      0,
    );
    expect(provider.updateItem).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith(
      context,
      runId,
      'action_required',
      [{ dataType: 'connection', code: 'unavailable' }],
      now,
    );
  });

  it('reports a product failure as partial after controlled retries', async () => {
    const { synchronization, provider, repository } = fixture();
    provider.listAccounts.mockRejectedValue(new PluggyUnavailable());
    const job = { runId, tenantId: context.tenantId, userId: context.userId };
    await expect(synchronization.processJob(job, 0)).rejects.toBeInstanceOf(
      PluggyUnavailable,
    );
    expect(repository.releaseRetry).toHaveBeenCalledWith(context, runId);
    await synchronization.processJob(job, 3);
    expect(repository.finish).toHaveBeenCalledWith(
      context,
      runId,
      'partial',
      [
        { dataType: 'accounts', code: 'failed' },
        { dataType: 'investments', code: 'unavailable' },
        { dataType: 'investment_transactions', code: 'unavailable' },
      ],
      now,
    );
  });
});
