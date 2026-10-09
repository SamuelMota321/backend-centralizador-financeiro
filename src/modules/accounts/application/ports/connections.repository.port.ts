import type {
  ConnectionRecord,
  ConnectionStatus,
} from '../../domain/connection.js';
import type {
  PluggyConsentSnapshot,
  PluggyItemSnapshot,
  PluggyWebhookEvent,
} from './pluggy-provider.port.js';

export type ProviderConnectionState = Readonly<{
  item: PluggyItemSnapshot | null;
  consent: PluggyConsentSnapshot | null;
}>;

export type ConnectionTransition = Readonly<{
  record: ConnectionRecord;
  from: ConnectionStatus | null;
  changed: boolean;
}>;

export const CONNECTIONS_COLLECTION_ELIGIBILITY = Symbol(
  'CONNECTIONS_COLLECTION_ELIGIBILITY',
);

export interface ConnectionsCollectionEligibility {
  canStartCollection(
    context: { tenantId: string; userId: string },
    connectionId: string,
    requestId: string,
  ): Promise<boolean>;
}

export interface TenantConnectionsRepository {
  createPending(input: {
    id: string;
    ownerUserId: string;
  }): Promise<ConnectionRecord>;
  findOwnedById(
    connectionId: string,
    ownerUserId: string,
  ): Promise<ConnectionRecord | null>;
  expireIfNeeded(
    connectionId: string,
    ownerUserId: string,
    now: Date,
  ): Promise<ConnectionTransition | null>;
  applyProviderState(input: {
    connectionId: string;
    ownerUserId: string;
    providerItemId: string;
    state: ProviderConnectionState;
    now: Date;
  }): Promise<ConnectionTransition | null>;
  disconnect(
    connectionId: string,
    ownerUserId: string,
  ): Promise<ConnectionTransition | null>;
  confirmProviderRevocation(
    connectionId: string,
    ownerUserId: string,
    revokedAt: Date,
  ): Promise<ConnectionTransition | null>;
  claimWebhook(
    context: { tenantId: string },
    event: PluggyWebhookEvent,
    payloadHash: string,
    now: Date,
  ): Promise<boolean>;
  completeWebhook(
    context: { tenantId: string },
    eventId: string,
    connectionId: string,
  ): Promise<void>;
}
