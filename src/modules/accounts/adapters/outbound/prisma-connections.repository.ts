import {
  ConnectionProvider as PrismaConnectionProvider,
  ConnectionStatus as PrismaConnectionStatus,
  ConsentStatus as PrismaConsentStatus,
} from '../../../../generated/prisma/client.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  ConnectionRecord,
  ConnectionStatus,
  ConsentStatus,
} from '../../domain/connection.js';
import type {
  ConnectionTransition,
  ProviderConnectionState,
  TenantConnectionsRepository,
} from '../../application/ports/connections.repository.port.js';
import type { PluggyWebhookEvent } from '../../application/ports/pluggy-provider.port.js';

const connectionSelect = {
  id: true,
  tenantId: true,
  ownerUserId: true,
  providerItemId: true,
  status: true,
  consentId: true,
  consentStatus: true,
  consentProducts: true,
  openFinancePermissionsGranted: true,
  consentCreatedAt: true,
  consentExpiresAt: true,
  consentRevokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FinancialConnectionSelect;

type DatabaseConnection = Prisma.FinancialConnectionGetPayload<{
  select: typeof connectionSelect;
}>;

const TO_DATABASE_STATUS: Record<ConnectionStatus, PrismaConnectionStatus> = {
  pending_authorization: PrismaConnectionStatus.PENDING_AUTHORIZATION,
  connected: PrismaConnectionStatus.CONNECTED,
  partially_available: PrismaConnectionStatus.PARTIALLY_AVAILABLE,
  expired: PrismaConnectionStatus.EXPIRED,
  revoked: PrismaConnectionStatus.REVOKED,
  disconnected: PrismaConnectionStatus.DISCONNECTED,
};

const FROM_DATABASE_STATUS: Record<PrismaConnectionStatus, ConnectionStatus> = {
  PENDING_AUTHORIZATION: 'pending_authorization',
  CONNECTED: 'connected',
  PARTIALLY_AVAILABLE: 'partially_available',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  DISCONNECTED: 'disconnected',
};

const TO_DATABASE_CONSENT_STATUS: Record<ConsentStatus, PrismaConsentStatus> = {
  granted: PrismaConsentStatus.GRANTED,
  expired: PrismaConsentStatus.EXPIRED,
  revoked: PrismaConsentStatus.REVOKED,
};

const FROM_DATABASE_CONSENT_STATUS: Record<PrismaConsentStatus, ConsentStatus> =
  {
    GRANTED: 'granted',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
  };

const WEBHOOK_IDEMPOTENCY_OPERATION = 'pluggy_webhook';
const WEBHOOK_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class ConnectionWebhookReplayConflict extends Error {
  override readonly name = 'ConnectionWebhookReplayConflict';
}

export class ConnectionAlreadyLinked extends Error {
  override readonly name = 'ConnectionAlreadyLinked';
}

export class PrismaTenantConnectionsRepository implements TenantConnectionsRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async createPending(input: {
    id: string;
    ownerUserId: string;
  }): Promise<ConnectionRecord> {
    const record = await this.transaction.financialConnection.create({
      data: {
        id: input.id,
        tenantId: this.context.tenantId,
        ownerUserId: input.ownerUserId,
        provider: PrismaConnectionProvider.PLUGGY,
        status: PrismaConnectionStatus.PENDING_AUTHORIZATION,
      },
      select: connectionSelect,
    });
    return toConnectionRecord(record);
  }

  async findOwnedById(
    connectionId: string,
    ownerUserId: string,
  ): Promise<ConnectionRecord | null> {
    const record = await this.transaction.financialConnection.findFirst({
      where: {
        id: connectionId,
        tenantId: this.context.tenantId,
        ownerUserId,
      },
      select: connectionSelect,
    });
    return record ? toConnectionRecord(record) : null;
  }

  async expireIfNeeded(
    connectionId: string,
    ownerUserId: string,
    now: Date,
  ): Promise<ConnectionTransition | null> {
    const current = await this.findOwnedForUpdate(connectionId, ownerUserId);
    if (!current) return null;
    if (
      (current.status !== 'connected' &&
        current.status !== 'partially_available') ||
      current.consentExpiresAt === null ||
      current.consentExpiresAt.getTime() > now.getTime()
    ) {
      return { record: current, from: null, changed: false };
    }

    const updated = await this.transaction.financialConnection.update({
      where: { id: current.id },
      data: {
        status: PrismaConnectionStatus.EXPIRED,
        consentStatus: PrismaConsentStatus.EXPIRED,
      },
      select: connectionSelect,
    });
    return {
      record: toConnectionRecord(updated),
      from: current.status,
      changed: true,
    };
  }

  async applyProviderState(input: {
    connectionId: string;
    ownerUserId: string;
    providerItemId: string;
    state: ProviderConnectionState;
    now: Date;
  }): Promise<ConnectionTransition | null> {
    const current = await this.findOwnedForUpdate(
      input.connectionId,
      input.ownerUserId,
    );
    if (!current) return null;
    if (current.status === 'disconnected' || current.status === 'revoked') {
      return { record: current, from: null, changed: false };
    }
    if (
      current.providerItemId !== null &&
      current.providerItemId !== input.providerItemId
    ) {
      throw new ConnectionAlreadyLinked();
    }

    if (input.state.item === null) {
      const deleted = await this.transaction.financialConnection.update({
        where: { id: current.id },
        data: {
          providerItemId: input.providerItemId,
          status: PrismaConnectionStatus.DISCONNECTED,
          ...(current.consentId || current.consentStatus
            ? {
                consentStatus: PrismaConsentStatus.REVOKED,
                consentRevokedAt: current.consentRevokedAt ?? input.now,
              }
            : {}),
        },
        select: connectionSelect,
      });
      return transition(current, deleted);
    }

    const consent = input.state.consent;
    if (consent && consent.itemId !== input.providerItemId) {
      throw new ConnectionAlreadyLinked();
    }
    const providerRevoked =
      input.state.item.executionStatus === 'USER_AUTHORIZATION_REVOKED';
    const consentRevoked =
      consent?.revokedAt !== null && consent?.revokedAt !== undefined;
    const consentExpired =
      consent?.expiresAt !== null &&
      consent?.expiresAt !== undefined &&
      consent.expiresAt.getTime() <= input.now.getTime();

    let status: ConnectionStatus;
    let consentStatus: ConsentStatus | null;
    if (providerRevoked || consentRevoked) {
      status = 'revoked';
      consentStatus = 'revoked';
    } else if (consentExpired) {
      status = 'expired';
      consentStatus = 'expired';
    } else if (!consent) {
      status = 'pending_authorization';
      consentStatus = null;
    } else if (
      input.state.item.status === 'UPDATED' &&
      input.state.item.executionStatus === 'PARTIAL_SUCCESS'
    ) {
      status = 'partially_available';
      consentStatus = 'granted';
    } else {
      status = 'connected';
      consentStatus = 'granted';
    }

    const updated = await this.transaction.financialConnection.update({
      where: { id: current.id },
      data: {
        providerItemId: input.providerItemId,
        status: TO_DATABASE_STATUS[status],
        consentId: consent?.id ?? null,
        consentStatus: consentStatus
          ? TO_DATABASE_CONSENT_STATUS[consentStatus]
          : null,
        consentProducts: consent ? [...consent.products] : [],
        openFinancePermissionsGranted: consent
          ? [...consent.openFinancePermissionsGranted]
          : [],
        consentCreatedAt: consent?.createdAt ?? null,
        consentExpiresAt: consent?.expiresAt ?? null,
        consentRevokedAt: consent?.revokedAt ?? null,
      },
      select: connectionSelect,
    });
    return transition(current, updated);
  }

  async disconnect(
    connectionId: string,
    ownerUserId: string,
  ): Promise<ConnectionTransition | null> {
    const current = await this.findOwnedForUpdate(connectionId, ownerUserId);
    if (!current) return null;
    if (current.status === 'disconnected') {
      return { record: current, from: null, changed: false };
    }
    const updated = await this.transaction.financialConnection.update({
      where: { id: current.id },
      data: { status: PrismaConnectionStatus.DISCONNECTED },
      select: connectionSelect,
    });
    return transition(current, updated);
  }

  async confirmProviderRevocation(
    connectionId: string,
    ownerUserId: string,
    revokedAt: Date,
  ): Promise<ConnectionTransition | null> {
    const current = await this.findOwnedForUpdate(connectionId, ownerUserId);
    if (!current) return null;
    const updated = await this.transaction.financialConnection.update({
      where: { id: current.id },
      data: {
        status: PrismaConnectionStatus.DISCONNECTED,
        ...(current.consentId || current.consentStatus
          ? {
              consentStatus: PrismaConsentStatus.REVOKED,
              consentRevokedAt: current.consentRevokedAt ?? revokedAt,
            }
          : {}),
      },
      select: connectionSelect,
    });
    return transition(current, updated);
  }

  async claimWebhook(
    context: { tenantId: string },
    event: PluggyWebhookEvent,
    payloadHash: string,
    now: Date,
  ): Promise<boolean> {
    const inserted = await this.transaction.$queryRaw<{ id: string }[]>`
      INSERT INTO public.idempotency_keys (
        tenant_id,
        operation,
        key,
        payload_hash,
        status,
        resource_ids,
        expires_at
      ) VALUES (
        ${context.tenantId}::uuid,
        ${WEBHOOK_IDEMPOTENCY_OPERATION},
        ${event.eventId},
        ${payloadHash},
        'pending'::public.idempotency_status,
        '[]'::jsonb,
        ${new Date(now.getTime() + WEBHOOK_IDEMPOTENCY_TTL_MS)}::timestamptz
      )
      ON CONFLICT (tenant_id, operation, key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) return true;

    const existing = await this.transaction.idempotencyKey.findUnique({
      where: {
        tenantId_operation_key: {
          tenantId: context.tenantId,
          operation: WEBHOOK_IDEMPOTENCY_OPERATION,
          key: event.eventId,
        },
      },
      select: { payloadHash: true },
    });
    if (!existing || existing.payloadHash !== payloadHash) {
      throw new ConnectionWebhookReplayConflict();
    }
    return false;
  }

  async completeWebhook(
    context: { tenantId: string },
    eventId: string,
    connectionId: string,
  ): Promise<void> {
    await this.transaction.idempotencyKey.update({
      where: {
        tenantId_operation_key: {
          tenantId: context.tenantId,
          operation: WEBHOOK_IDEMPOTENCY_OPERATION,
          key: eventId,
        },
      },
      data: {
        status: 'COMPLETED',
        resourceIds: [connectionId],
      },
    });
  }

  private async findOwnedForUpdate(
    connectionId: string,
    ownerUserId: string,
  ): Promise<ConnectionRecord | null> {
    const locked = await this.transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM public.connections
      WHERE id = ${connectionId}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
        AND owner_user_id = ${ownerUserId}::uuid
      FOR UPDATE
    `;
    if (!locked[0]) return null;
    return this.findOwnedById(connectionId, ownerUserId);
  }
}

function transition(
  previous: ConnectionRecord,
  next: DatabaseConnection,
): ConnectionTransition {
  const record = toConnectionRecord(next);
  const statusChanged = previous.status !== record.status;
  const consentChanged =
    previous.consentId !== record.consentId ||
    previous.consentStatus !== record.consentStatus ||
    previous.consentCreatedAt?.getTime() !==
      record.consentCreatedAt?.getTime() ||
    previous.consentExpiresAt?.getTime() !==
      record.consentExpiresAt?.getTime() ||
    previous.consentRevokedAt?.getTime() !==
      record.consentRevokedAt?.getTime() ||
    !sameValues(previous.consentProducts, record.consentProducts) ||
    !sameValues(
      previous.openFinancePermissionsGranted,
      record.openFinancePermissionsGranted,
    );
  return {
    record,
    from: statusChanged ? previous.status : null,
    changed: statusChanged || consentChanged,
  };
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function toConnectionRecord(record: DatabaseConnection): ConnectionRecord {
  return {
    ...record,
    providerItemId: record.providerItemId,
    status: FROM_DATABASE_STATUS[record.status],
    consentStatus: record.consentStatus
      ? FROM_DATABASE_CONSENT_STATUS[record.consentStatus]
      : null,
    consentProducts: record.consentProducts,
    openFinancePermissionsGranted: record.openFinancePermissionsGranted,
  };
}
