import { describe, expect, it, vi } from 'vitest';
import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import type { ConnectionRecord } from '../../domain/connection.js';
import { ConnectionNotFound } from '../../domain/connection.errors.js';
import type { AccountMaintenanceScope } from '../ports/accounts.repository.port.js';
import type {
  ConnectionTransition,
  TenantConnectionsRepository,
} from '../ports/connections.repository.port.js';
import type {
  PluggyConsentSnapshot,
  PluggyItemSnapshot,
  PluggyProvider,
  PluggyWebhookEvent,
} from '../ports/pluggy-provider.port.js';
import {
  AccountsConnectionCollectionEligibility,
  createClientUserId,
  PluggyConnectionLifecycle,
} from './pluggy-connection-lifecycle.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const connectionId = '164aa078-983d-4c39-aae4-dda44b495970';
const itemId = '55aa5555-5555-4555-8555-555555555555';
const requestId = '264aa078-983d-4c39-aae4-dda44b495970';
const now = new Date('2026-10-09T10:00:00.000Z');

function makeRecord(
  overrides: Partial<ConnectionRecord> = {},
): ConnectionRecord {
  return {
    id: connectionId,
    tenantId: context.tenantId,
    ownerUserId: context.userId,
    providerItemId: itemId,
    status: 'pending_authorization',
    consentId: null,
    consentStatus: null,
    consentProducts: [],
    openFinancePermissionsGranted: [],
    consentCreatedAt: null,
    consentExpiresAt: null,
    consentRevokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeHarness(
  options: {
    initialRecord?: ConnectionRecord;
    item?: PluggyItemSnapshot | null;
    consents?: readonly PluggyConsentSnapshot[];
    webhookAlreadyClaimed?: boolean;
    events?: string[];
    deleteError?: Error;
    applyResult?: ConnectionTransition | null;
  } = {},
) {
  const events = options.events ?? [];
  let record = options.initialRecord ?? makeRecord();
  const created = vi.fn((input: { id: string; ownerUserId: string }) => {
    record = makeRecord({ id: input.id, ownerUserId: input.ownerUserId });
    return Promise.resolve(record);
  });
  const expire = vi.fn(() => Promise.resolve(null));
  const applyProviderState = vi.fn(() =>
    Promise.resolve(options.applyResult ?? null),
  );
  const disconnect = vi.fn(() => {
    events.push('database-disconnect');
    const previous = record;
    record = { ...record, status: 'disconnected' };
    return Promise.resolve({ record, from: previous.status, changed: true });
  });
  const confirmProviderRevocation = vi.fn(() => {
    events.push('database-confirm-revocation');
    record = { ...record, consentStatus: 'revoked' };
    return Promise.resolve({ record, from: null, changed: true });
  });
  const claimWebhook = vi.fn(() =>
    Promise.resolve(options.webhookAlreadyClaimed !== true),
  );
  const completeWebhook = vi.fn(() => Promise.resolve());
  const connections: TenantConnectionsRepository = {
    createPending: created,
    findOwnedById: vi.fn((id, ownerUserId) =>
      Promise.resolve(
        id === record.id && ownerUserId === record.ownerUserId ? record : null,
      ),
    ),
    expireIfNeeded: expire,
    applyProviderState,
    disconnect,
    confirmProviderRevocation,
    claimWebhook,
    completeWebhook,
  };
  const auditWrites: AuditRecord[] = [];
  const audit: AuditWriter = {
    write: vi.fn((auditRecord: AuditRecord) => {
      auditWrites.push(auditRecord);
      return Promise.resolve();
    }),
  };
  const accounts = {
    findPossibleConnectedDuplicates: () => Promise.resolve([]),
    createManual: () => Promise.reject(new Error('Not used by this test.')),
    countActive: () => Promise.resolve(0),
    findActive: () => Promise.resolve([]),
    findByIdForUpdate: () => Promise.resolve(null),
    update: () => Promise.reject(new Error('Not used by this test.')),
    deactivate: () => Promise.reject(new Error('Not used by this test.')),
  };
  const scope: AccountMaintenanceScope = { accounts, connections, audit };
  const unitOfWork: TenantUnitOfWork<AccountMaintenanceScope> = {
    run<Result>(
      _context: TenantContext,
      operation: (scope: AccountMaintenanceScope) => Promise<Result>,
    ): Promise<Result> {
      return operation(scope);
    },
  };
  const item: PluggyItemSnapshot = options.item ?? {
    id: itemId,
    clientUserId: createClientUserId(context, connectionId),
    status: 'UPDATED',
    executionStatus: 'SUCCESS',
  };
  const providerCreateConnectToken = vi.fn(() =>
    Promise.resolve({
      accessToken: 'test-connect-token-placeholder',
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    }),
  );
  const providerGetItem = vi.fn(() =>
    Promise.resolve(options.item === null ? null : item),
  );
  const providerListConsents = vi.fn(() =>
    Promise.resolve(options.consents ?? []),
  );
  const providerDeleteItem = vi.fn(() => {
    events.push('provider-delete');
    return options.deleteError
      ? Promise.reject(options.deleteError)
      : Promise.resolve();
  });
  const provider: PluggyProvider = {
    createConnectToken: providerCreateConnectToken,
    getItem: providerGetItem,
    listConsents: providerListConsents,
    deleteItem: providerDeleteItem,
  };
  return {
    lifecycle: new PluggyConnectionLifecycle(unitOfWork, provider, () => now),
    unitOfWork,
    provider,
    providerCreateConnectToken,
    providerGetItem,
    providerListConsents,
    connections,
    created,
    expire,
    applyProviderState,
    disconnect,
    confirmProviderRevocation,
    claimWebhook,
    completeWebhook,
    auditWrites,
    events,
    get record() {
      return record;
    },
  };
}

describe('Pluggy connection lifecycle', () => {
  it('returns the limited Connect Token and keeps it out of durable connection state', async () => {
    const harness = makeHarness();

    const result = await harness.lifecycle.start(context, requestId);

    expect(result.connectToken).toBe('test-connect-token-placeholder');
    expect(result.expiresAt).toBe('2026-10-09T10:30:00.000Z');
    expect(result.connection.status).toBe('pending_authorization');
    expect(harness.providerCreateConnectToken).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/),
    );
    expect(harness.created.mock.calls[0]?.[0]).not.toHaveProperty(
      'connectToken',
    );
    expect(harness.auditWrites[0]?.props.metadata).toEqual({
      stateTransition: 'created_to_pending_authorization',
    });
  });

  it('hides a Pluggy Item owned by a different tenant', async () => {
    const harness = makeHarness({
      item: {
        id: itemId,
        clientUserId: createClientUserId(
          {
            tenantId: '31b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
            userId: context.userId,
          },
          connectionId,
        ),
        status: 'UPDATED',
        executionStatus: 'SUCCESS',
      },
    });

    await expect(
      harness.lifecycle.complete(context, itemId, requestId),
    ).rejects.toBeInstanceOf(ConnectionNotFound);
    expect(harness.providerListConsents).not.toHaveBeenCalled();
  });

  it('commits local disconnect before asking Pluggy to revoke the Item', async () => {
    const harness = makeHarness({ events: [] });

    const result = await harness.lifecycle.disconnect(
      context,
      connectionId,
      requestId,
    );

    expect(harness.events).toEqual([
      'database-disconnect',
      'provider-delete',
      'database-confirm-revocation',
    ]);
    expect(result.status).toBe('disconnected');
    expect(result.consent.status).toBe('revoked');
  });

  it('keeps local collection blocked when remote deletion fails', async () => {
    const harness = makeHarness({ deleteError: new Error('provider failure') });

    await expect(
      harness.lifecycle.disconnect(context, connectionId, requestId),
    ).rejects.toThrow('provider failure');
    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.confirmProviderRevocation).not.toHaveBeenCalled();
  });

  it('does not reapply a webhook event already committed by a previous delivery', async () => {
    const harness = makeHarness({ webhookAlreadyClaimed: true });
    const event: PluggyWebhookEvent = {
      event: 'item/updated',
      eventId: '77aa7777-7777-4777-8777-777777777777',
      itemId,
      clientUserId: createClientUserId(context, connectionId),
    };

    await harness.lifecycle.processWebhook(event);

    expect(harness.providerGetItem).toHaveBeenCalledWith(itemId);
    expect(harness.applyProviderState).not.toHaveBeenCalled();
    expect(harness.completeWebhook).not.toHaveBeenCalled();
  });

  it('marks a deleted provider Item disconnected even if the lookup is still visible', async () => {
    const harness = makeHarness();
    const event: PluggyWebhookEvent = {
      event: 'item/deleted',
      eventId: '77aa7777-7777-4777-8777-777777777777',
      itemId,
      clientUserId: createClientUserId(context, connectionId),
    };

    await expect(
      harness.lifecycle.processWebhook(event),
    ).rejects.toBeInstanceOf(ConnectionNotFound);

    expect(harness.providerGetItem).toHaveBeenCalledWith(itemId);
    expect(harness.providerListConsents).not.toHaveBeenCalled();
    expect(harness.applyProviderState).toHaveBeenCalledWith(
      expect.objectContaining({
        providerItemId: itemId,
        state: { item: null, consent: null },
      }),
    );
  });

  it('rechecks provider consent before allowing future collection', async () => {
    const connected = makeRecord({
      status: 'connected',
      consentId: '88aa8888-8888-4888-8888-888888888888',
      consentStatus: 'granted',
    });
    const revoked = makeRecord({
      status: 'revoked',
      consentId: '88aa8888-8888-4888-8888-888888888888',
      consentStatus: 'revoked',
      consentRevokedAt: now,
    });
    const harness = makeHarness({
      initialRecord: connected,
      consents: [
        {
          id: revoked.consentId!,
          itemId,
          products: ['ACCOUNTS'],
          openFinancePermissionsGranted: [],
          createdAt: now,
          expiresAt: null,
          revokedAt: now,
        },
      ],
      applyResult: { record: revoked, from: 'connected', changed: true },
    });
    const eligibility = new AccountsConnectionCollectionEligibility(
      harness.unitOfWork,
      harness.provider,
      () => now,
    );

    await expect(
      eligibility.canStartCollection(context, connectionId, requestId),
    ).resolves.toBe(false);

    expect(harness.providerGetItem).toHaveBeenCalledWith(itemId);
    expect(harness.providerListConsents).toHaveBeenCalledWith(itemId);
    expect(harness.applyProviderState).toHaveBeenCalledOnce();
  });
});
