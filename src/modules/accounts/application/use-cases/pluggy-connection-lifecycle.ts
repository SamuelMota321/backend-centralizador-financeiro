import { createHash, randomUUID } from 'node:crypto';
import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AccountMaintenanceScope } from '../ports/accounts.repository.port.js';
import type {
  PluggyConsentSnapshot,
  PluggyProvider,
  PluggyWebhookEvent,
} from '../ports/pluggy-provider.port.js';
import {
  canStartConnectionCollection,
  toConnectionView,
  type ConnectionStatus,
} from '../../domain/connection.js';
import {
  ConnectionNotFound,
  InvalidPluggyWebhook,
} from '../../domain/connection.errors.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PluggyConnectionLifecycle {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
    private readonly provider: PluggyProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(
    context: TenantContext,
    requestId: string,
  ): Promise<{
    connection: ReturnType<typeof toConnectionView>;
    connectToken: string;
    expiresAt: string;
  }> {
    assertTenantContext(context);
    const connectionId = randomUUID();
    const clientUserId = createClientUserId(context, connectionId);
    const token = await this.provider.createConnectToken(clientUserId);

    const connection = await this.unitOfWork.run(
      context,
      async ({ connections, audit }) => {
        const record = await connections.createPending({
          id: connectionId,
          ownerUserId: context.userId,
        });
        await audit.write(
          AuditRecord.create({
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: 'connection_lifecycle_updated',
            resourceType: 'connection',
            resourceId: connectionId,
            outcome: 'success',
            requestId,
            metadata: { stateTransition: 'created_to_pending_authorization' },
          }),
        );
        return toConnectionView(record);
      },
    );

    return {
      connection,
      connectToken: token.accessToken,
      expiresAt: token.expiresAt.toISOString(),
    };
  }

  async complete(
    context: TenantContext,
    itemId: string,
    requestId: string,
  ): Promise<ReturnType<typeof toConnectionView>> {
    assertTenantContext(context);
    const item = await this.provider.getItem(itemId);
    if (!item || item.id !== itemId) throw new ConnectionNotFound();

    const clientUser = parseClientUserId(item.clientUserId);
    if (
      !clientUser ||
      clientUser.tenantId !== context.tenantId ||
      clientUser.userId !== context.userId
    ) {
      throw new ConnectionNotFound();
    }

    const consents = await this.provider.listConsents(itemId);
    const consent = chooseConsent(consents, itemId, this.now());
    const transition = await this.unitOfWork.run(
      context,
      async ({ connections, audit }) => {
        const result = await connections.applyProviderState({
          connectionId: clientUser.connectionId,
          ownerUserId: context.userId,
          providerItemId: itemId,
          state: { item, consent },
          now: this.now(),
        });
        if (!result) throw new ConnectionNotFound();
        if (result.changed) {
          await writeConnectionAudit(
            audit,
            context,
            requestId,
            result.record.id,
            result.from,
            result.record.status,
          );
        }
        return result.record;
      },
    );
    return toConnectionView(transition);
  }

  async get(
    context: TenantContext,
    connectionId: string,
    requestId: string,
  ): Promise<ReturnType<typeof toConnectionView>> {
    assertTenantContext(context);
    const record = await this.unitOfWork.run(
      context,
      async ({ connections, audit }) => {
        const result = await connections.expireIfNeeded(
          connectionId,
          context.userId,
          this.now(),
        );
        if (!result) throw new ConnectionNotFound();
        if (result.changed) {
          await writeConnectionAudit(
            audit,
            context,
            requestId,
            result.record.id,
            result.from,
            result.record.status,
          );
        }
        return result.record;
      },
    );
    return toConnectionView(record);
  }

  async disconnect(
    context: TenantContext,
    connectionId: string,
    requestId: string,
  ): Promise<ReturnType<typeof toConnectionView>> {
    assertTenantContext(context);
    const disconnected = await this.unitOfWork.run(
      context,
      async ({ connections, audit }) => {
        const result = await connections.disconnect(
          connectionId,
          context.userId,
        );
        if (!result) throw new ConnectionNotFound();
        if (result.changed) {
          await writeConnectionAudit(
            audit,
            context,
            requestId,
            result.record.id,
            result.from,
            result.record.status,
          );
        }
        return result.record;
      },
    );

    if (disconnected.providerItemId) {
      await this.provider.deleteItem(disconnected.providerItemId);
      const confirmed = await this.unitOfWork.run(
        context,
        async ({ connections, audit }) => {
          const result = await connections.confirmProviderRevocation(
            connectionId,
            context.userId,
            this.now(),
          );
          if (result?.changed) {
            await writeConnectionAudit(
              audit,
              context,
              requestId,
              result.record.id,
              result.from,
              result.record.status,
            );
          }
          return result;
        },
      );
      if (!confirmed) throw new ConnectionNotFound();
      return toConnectionView(confirmed.record);
    }
    return toConnectionView(disconnected);
  }

  async processWebhook(event: PluggyWebhookEvent): Promise<void> {
    const clientUser = parseClientUserId(event.clientUserId);
    if (!clientUser) throw new InvalidPluggyWebhook();
    const context: TenantContext = {
      tenantId: clientUser.tenantId,
      userId: clientUser.userId,
    };
    assertTenantContext(context);

    const providerItem = await this.provider.getItem(event.itemId);
    if (
      providerItem &&
      (providerItem.id !== event.itemId ||
        providerItem.clientUserId !== event.clientUserId)
    ) {
      throw new InvalidPluggyWebhook();
    }
    const item = event.event === 'item/deleted' ? null : providerItem;
    const consent = item
      ? chooseConsent(
          await this.provider.listConsents(event.itemId),
          event.itemId,
          this.now(),
        )
      : null;
    const payloadHash = createWebhookHash(event);

    await this.unitOfWork.run(context, async ({ connections, audit }) => {
      const claimed = await connections.claimWebhook(
        context,
        event,
        payloadHash,
        this.now(),
      );
      if (!claimed) return;

      const result = await connections.applyProviderState({
        connectionId: clientUser.connectionId,
        ownerUserId: clientUser.userId,
        providerItemId: event.itemId,
        state: { item, consent },
        now: this.now(),
      });
      if (!result) throw new ConnectionNotFound();
      if (result.changed) {
        await writeConnectionAudit(
          audit,
          context,
          event.eventId,
          result.record.id,
          result.from,
          result.record.status,
        );
      }
      await connections.completeWebhook(
        context,
        event.eventId,
        result.record.id,
      );
    });
  }
}

export class AccountsConnectionCollectionEligibility {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
    private readonly provider: PluggyProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async canStartCollection(
    context: TenantContext,
    connectionId: string,
    requestId: string,
  ): Promise<boolean> {
    assertTenantContext(context);
    const current = await this.unitOfWork.run(
      context,
      async ({ connections }) => {
        const record = await connections.findOwnedById(
          connectionId,
          context.userId,
        );
        return record ?? null;
      },
    );
    if (
      !current?.providerItemId ||
      !canStartConnectionCollection(current, this.now())
    ) {
      return false;
    }

    const providerItemId = current.providerItemId;
    const item = await this.provider.getItem(providerItemId);
    if (
      item &&
      (item.id !== providerItemId ||
        item.clientUserId !== createClientUserId(context, connectionId))
    ) {
      return false;
    }
    const consent = item
      ? chooseConsent(
          await this.provider.listConsents(providerItemId),
          providerItemId,
          this.now(),
        )
      : null;

    const refreshed = await this.unitOfWork.run(
      context,
      async ({ connections, audit }) => {
        const result = await connections.applyProviderState({
          connectionId,
          ownerUserId: context.userId,
          providerItemId,
          state: { item, consent },
          now: this.now(),
        });
        if (!result) return null;
        if (result.changed) {
          await writeConnectionAudit(
            audit,
            context,
            requestId,
            result.record.id,
            result.from,
            result.record.status,
          );
        }
        return result.record;
      },
    );
    return refreshed
      ? canStartConnectionCollection(refreshed, this.now())
      : false;
  }
}

export function createClientUserId(
  context: TenantContext,
  connectionId: string,
): string {
  return `${context.tenantId}:${context.userId}:${connectionId}`;
}

function parseClientUserId(
  value: string | null,
): { tenantId: string; userId: string; connectionId: string } | null {
  if (!value) return null;
  const [tenantId, userId, connectionId, ...extra] = value.split(':');
  if (
    extra.length > 0 ||
    !tenantId ||
    !userId ||
    !connectionId ||
    !UUID_PATTERN.test(tenantId) ||
    !UUID_PATTERN.test(userId) ||
    !UUID_PATTERN.test(connectionId)
  ) {
    return null;
  }
  return {
    tenantId: tenantId.toLowerCase(),
    userId: userId.toLowerCase(),
    connectionId: connectionId.toLowerCase(),
  };
}

function chooseConsent(
  consents: readonly PluggyConsentSnapshot[],
  itemId: string,
  now: Date,
): PluggyConsentSnapshot | null {
  const ordered = consents
    .filter((consent) => consent.itemId === itemId)
    .toSorted(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  return (
    ordered.find(
      (consent) =>
        consent.revokedAt === null &&
        (consent.expiresAt === null ||
          consent.expiresAt.getTime() > now.getTime()),
    ) ??
    ordered[0] ??
    null
  );
}

function createWebhookHash(event: PluggyWebhookEvent): string {
  return createHash('sha256')
    .update(
      `${event.eventId}\0${event.event}\0${event.itemId}\0${event.clientUserId}`,
    )
    .digest('hex');
}

async function writeConnectionAudit(
  audit: AccountMaintenanceScope['audit'],
  context: TenantContext,
  requestId: string,
  connectionId: string,
  from: ConnectionStatus | null,
  to: ConnectionStatus,
): Promise<void> {
  await audit.write(
    AuditRecord.create({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      action: 'connection_lifecycle_updated',
      resourceType: 'connection',
      resourceId: connectionId,
      outcome: 'success',
      requestId,
      metadata: from
        ? {
            stateTransition: `${from}_to_${to}`,
          }
        : { stateTransition: 'consent_updated' },
    }),
  );
}
