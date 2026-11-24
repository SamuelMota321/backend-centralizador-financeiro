import { Injectable } from '@nestjs/common';
import {
  PluggySyncRunStatus,
  PluggySyncTrigger,
  Prisma,
  type PluggySyncRun as DbRun,
} from '../../../../generated/prisma/client.js';
import { PrismaService } from '../../../../infrastructure/database/prisma.service.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  PluggyAccountSnapshot,
  PluggyInvestmentMovementSnapshot,
  PluggyInvestmentSnapshot,
} from '../../../accounts/application/ports/pluggy-provider.port.js';
import {
  ConnectionNotFound,
  ConnectionRequestConflict,
} from '../../../accounts/domain/connection.errors.js';
import type { PluggySyncRepository } from '../../application/ports/pluggy-sync.repository.port.js';
import type {
  SyncReason,
  SyncRun,
  SyncTarget,
} from '../../application/pluggy-sync.types.js';

const activeStatuses = [
  PluggySyncRunStatus.QUEUED,
  PluggySyncRunStatus.RUNNING,
];
const reconciledStatuses = [
  PluggySyncRunStatus.SUCCEEDED,
  PluggySyncRunStatus.PARTIAL,
];

function toRun(record: DbRun): SyncRun {
  return {
    id: record.id,
    tenantId: record.tenantId,
    connectionId: record.connectionId,
    ownerUserId: record.ownerUserId,
    trigger: record.trigger === PluggySyncTrigger.MANUAL ? 'manual' : 'daily',
    status: record.status.toLowerCase() as SyncRun['status'],
    reasons: Array.isArray(record.reasons)
      ? (record.reasons as SyncReason[])
      : [],
    acceptedAt: record.acceptedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    referenceDate: record.referenceDate,
    updateRequestedAt: record.updateRequestedAt,
  };
}

@Injectable()
export class PrismaPluggySyncRepository implements PluggySyncRepository {
  constructor(
    private readonly tenantTransaction: PrismaTenantTransaction,
    private readonly prisma: PrismaService,
  ) {}

  async createManual(
    context: TenantContext,
    connectionId: string,
  ): Promise<{ run: SyncRun; created: boolean }> {
    try {
      return await this.tenantTransaction.run(context, async (transaction) => {
        const connection = await transaction.financialConnection.findFirst({
          where: {
            id: connectionId,
            tenantId: context.tenantId,
            ownerUserId: context.userId,
          },
        });
        if (!connection) throw new ConnectionNotFound();
        if (!manuallyRequestable(connection))
          throw new ConnectionRequestConflict();
        const active = await transaction.pluggySyncRun.findFirst({
          where: {
            tenantId: context.tenantId,
            connectionId,
            status: { in: activeStatuses },
          },
          orderBy: { acceptedAt: 'desc' },
        });
        if (active) return { run: toRun(active), created: false };
        return {
          run: toRun(
            await transaction.pluggySyncRun.create({
              data: {
                tenantId: context.tenantId,
                connectionId,
                ownerUserId: context.userId,
                trigger: PluggySyncTrigger.MANUAL,
              },
            }),
          ),
          created: true,
        };
      });
    } catch (error: unknown) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      )
        throw error;
      const active = await this.tenantTransaction.run(context, (transaction) =>
        transaction.pluggySyncRun.findFirst({
          where: {
            tenantId: context.tenantId,
            connectionId,
            ownerUserId: context.userId,
            status: { in: activeStatuses },
          },
        }),
      );
      if (!active) throw new ConnectionRequestConflict();
      return { run: toRun(active), created: false };
    }
  }

  async createDaily(
    target: SyncTarget,
    civilDate: string,
  ): Promise<SyncRun | null> {
    const context = { tenantId: target.tenantId, userId: target.userId };
    try {
      return await this.tenantTransaction.run(context, async (transaction) => {
        const connection = await transaction.financialConnection.findFirst({
          where: {
            id: target.connectionId,
            tenantId: target.tenantId,
            ownerUserId: target.userId,
          },
        });
        if (!connection || !eligible(connection)) return null;
        const existing = await transaction.pluggySyncRun.findFirst({
          where: {
            tenantId: target.tenantId,
            connectionId: target.connectionId,
            trigger: PluggySyncTrigger.DAILY,
            civilDate: new Date(`${civilDate}T00:00:00.000Z`),
          },
        });
        if (existing)
          return existing.status === PluggySyncRunStatus.QUEUED
            ? toRun(existing)
            : null;
        const active = await transaction.pluggySyncRun.findFirst({
          where: {
            tenantId: target.tenantId,
            connectionId: target.connectionId,
            status: { in: activeStatuses },
          },
        });
        if (active) return null;
        return toRun(
          await transaction.pluggySyncRun.create({
            data: {
              tenantId: target.tenantId,
              connectionId: target.connectionId,
              ownerUserId: target.userId,
              trigger: PluggySyncTrigger.DAILY,
              civilDate: new Date(`${civilDate}T00:00:00.000Z`),
            },
          }),
        );
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return null;
      throw error;
    }
  }

  async findOwned(
    context: TenantContext,
    connectionId: string,
    runId: string,
  ): Promise<SyncRun | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const row = await transaction.pluggySyncRun.findFirst({
        where: {
          id: runId,
          tenantId: context.tenantId,
          connectionId,
          ownerUserId: context.userId,
        },
      });
      return row ? toRun(row) : null;
    });
  }

  async latestOwned(
    context: TenantContext,
    connectionId: string,
  ): Promise<{
    latest: SyncRun | null;
    lastReconciled: SyncRun | null;
  } | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const connection = await transaction.financialConnection.findFirst({
        where: {
          id: connectionId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
        },
        select: { id: true },
      });
      if (!connection) return null;
      const [latest, lastReconciled] = await Promise.all([
        transaction.pluggySyncRun.findFirst({
          where: { tenantId: context.tenantId, connectionId },
          orderBy: { acceptedAt: 'desc' },
        }),
        transaction.pluggySyncRun.findFirst({
          where: {
            tenantId: context.tenantId,
            connectionId,
            status: { in: reconciledStatuses },
          },
          orderBy: { completedAt: 'desc' },
        }),
      ]);
      return {
        latest: latest ? toRun(latest) : null,
        lastReconciled: lastReconciled ? toRun(lastReconciled) : null,
      };
    });
  }

  async findJob(
    context: TenantContext,
    runId: string,
  ): Promise<SyncRun | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const row = await transaction.pluggySyncRun.findFirst({
        where: {
          id: runId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
        },
      });
      return row ? toRun(row) : null;
    });
  }

  async claim(context: TenantContext, runId: string): Promise<boolean> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const rows = await transaction.$queryRaw<{ id: string }[]>`
        UPDATE public.pluggy_sync_runs SET status = 'running'::public.pluggy_sync_run_status,
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          lease_until = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
        WHERE id = ${runId}::uuid AND tenant_id = ${context.tenantId}::uuid
          AND owner_user_id = ${context.userId}::uuid
          AND (status = 'queued'::public.pluggy_sync_run_status
            OR (status = 'running'::public.pluggy_sync_run_status AND lease_until < CURRENT_TIMESTAMP))
        RETURNING id
      `;
      return rows.length === 1;
    });
  }

  async releaseRetry(context: TenantContext, runId: string): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      await transaction.pluggySyncRun.updateMany({
        where: {
          id: runId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          status: PluggySyncRunStatus.RUNNING,
        },
        data: { status: PluggySyncRunStatus.QUEUED, leaseUntil: null },
      });
    });
  }

  async markUpdateRequested(
    context: TenantContext,
    runId: string,
  ): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      await transaction.pluggySyncRun.updateMany({
        where: {
          id: runId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          status: PluggySyncRunStatus.RUNNING,
        },
        data: { updateRequestedAt: new Date() },
      });
    });
  }

  async finish(
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
  ): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      const run = await transaction.pluggySyncRun.findFirst({
        where: {
          id: runId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          status: { in: activeStatuses },
        },
        select: { connectionId: true },
      });
      if (!run) return;
      let publishInvestments = Boolean(collection?.investmentsComplete);
      if (publishInvestments) {
        const rows = await transaction.$queryRaw<
          {
            status: string;
            consent_status: string | null;
            consent_products: string[];
            consent_expires_at: Date | null;
            consent_revoked_at: Date | null;
          }[]
        >`
          SELECT status::text, consent_status::text, consent_products,
                 consent_expires_at, consent_revoked_at
          FROM public.connections
          WHERE id = ${run.connectionId}::uuid
            AND tenant_id = ${context.tenantId}::uuid
            AND owner_user_id = ${context.userId}::uuid
          FOR UPDATE
        `;
        const connection = rows[0];
        publishInvestments = Boolean(
          connection &&
          ['connected', 'partially_available'].includes(connection.status) &&
          connection.consent_status === 'granted' &&
          !connection.consent_revoked_at &&
          (!connection.consent_expires_at ||
            connection.consent_expires_at > new Date()) &&
          ['INVESTMENTS', 'INVESTMENTS_TRANSACTIONS'].every((product) =>
            connection.consent_products.includes(product),
          ),
        );
      }
      const consentChanged = Boolean(
        collection?.investmentsComplete && !publishInvestments,
      );
      const finished = await transaction.pluggySyncRun.updateMany({
        where: {
          id: runId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          status: { in: activeStatuses },
        },
        data: {
          status: (consentChanged && status === 'succeeded'
            ? PluggySyncRunStatus.PARTIAL
            : status.toUpperCase()) as PluggySyncRunStatus,
          reasons: consentChanged
            ? [
                ...reasons.filter(
                  (reason) =>
                    reason.dataType !== 'investments' &&
                    reason.dataType !== 'investment_transactions',
                ),
                { dataType: 'investments', code: 'unavailable' },
                { dataType: 'investment_transactions', code: 'unavailable' },
              ]
            : reasons,
          referenceDate,
          investmentsComplete: publishInvestments,
          movementsComplete:
            publishInvestments && Boolean(collection?.movementsComplete),
          completedAt: new Date(),
          retentionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          leaseUntil: null,
        },
      });
      if (finished.count !== 1 || !publishInvestments || !collection) return;
      for (const { investment, movements } of collection.investments) {
        const investmentId = await this.saveInvestment(
          transaction,
          context.tenantId,
          run.connectionId,
          runId,
          investment,
        );
        if (!collection.movementsComplete) continue;
        for (const movement of movements) {
          await this.saveMovement(
            transaction,
            context.tenantId,
            run.connectionId,
            investmentId,
            runId,
            movement,
          );
        }
      }
    });
  }

  async listDailyTargets(): Promise<readonly SyncTarget[]> {
    const rows = await this.prisma.$queryRaw<
      { tenant_id: string; owner_user_id: string; connection_id: string }[]
    >`
      SELECT * FROM app_private.list_daily_pluggy_sync_targets()
    `;
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      userId: row.owner_user_id,
      connectionId: row.connection_id,
    }));
  }

  async pruneExpiredRuns(): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { count: number }[]
    >`SELECT app_private.prune_expired_pluggy_sync_runs() AS count`;
    return rows[0]?.count ?? 0;
  }

  async saveAccount(
    context: TenantContext,
    connectionId: string,
    account: PluggyAccountSnapshot,
    referenceDate: Date,
  ): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      await transaction.pluggyAccountSnapshot.upsert({
        where: {
          tenantId_connectionId_providerAccountId: {
            tenantId: context.tenantId,
            connectionId,
            providerAccountId: account.id,
          },
        },
        create: {
          tenantId: context.tenantId,
          connectionId,
          providerAccountId: account.id,
          name: account.name,
          type: account.type,
          balance: account.balance,
          currencyCode: account.currencyCode,
          referenceDate,
        },
        update: {
          name: account.name,
          type: account.type,
          balance: account.balance,
          currencyCode: account.currencyCode,
          referenceDate,
        },
      });
    });
  }

  async mappedAccounts(
    context: TenantContext,
    connectionId: string,
  ): Promise<ReadonlyMap<string, string>> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const run = await transaction.pluggyInitialImportRun.findUnique({
        where: {
          tenantId_connectionId: { tenantId: context.tenantId, connectionId },
        },
        include: {
          accounts: {
            where: { mappingStatus: 'MAPPED' },
            select: { providerAccountId: true, mappedAccountId: true },
          },
        },
      });
      return new Map(
        (run?.accounts ?? [])
          .filter((row) => row.mappedAccountId !== null)
          .map((row) => [row.providerAccountId, row.mappedAccountId!]),
      );
    });
  }

  private async saveInvestment(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    connectionId: string,
    runId: string,
    investment: PluggyInvestmentSnapshot,
  ): Promise<string> {
    const data = {
      name: investment.name,
      type: investment.type,
      status: investment.status,
      subtype: investment.subtype,
      balance: investment.balance,
      currencyCode: investment.currencyCode,
      quantity: investment.quantity,
      amount: investment.amount,
      amountOriginal: investment.amountOriginal,
      amountProfit: investment.amountProfit,
      institutionName: investment.institutionName,
      rate: investment.rate,
      rateType: investment.rateType,
      fixedAnnualRate: investment.fixedAnnualRate,
      maturityDate: investment.maturityDate
        ? new Date(investment.maturityDate)
        : null,
      referenceDate: investment.date ? new Date(investment.date) : null,
      lastSeenRunId: runId,
    };
    const row = await transaction.pluggyInvestment.upsert({
      where: {
        tenantId_connectionId_providerId: {
          tenantId,
          connectionId,
          providerId: investment.id,
        },
      },
      create: {
        tenantId,
        connectionId,
        providerId: investment.id,
        ...data,
      },
      update: data,
      select: { id: true },
    });
    return row.id;
  }

  private async saveMovement(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    connectionId: string,
    investmentId: string,
    runId: string,
    movement: PluggyInvestmentMovementSnapshot,
  ): Promise<void> {
    const data = {
      type: movement.type,
      amount: movement.amount,
      occurredAt: new Date(movement.date),
      lastSeenRunId: runId,
    };
    await transaction.pluggyInvestmentMovement.upsert({
      where: {
        tenantId_connectionId_investmentId_providerId: {
          tenantId,
          connectionId,
          investmentId,
          providerId: movement.id,
        },
      },
      create: {
        tenantId,
        connectionId,
        investmentId,
        providerId: movement.id,
        ...data,
      },
      update: data,
    });
  }
}

function eligible(connection: {
  status: string;
  consentStatus: string | null;
  consentExpiresAt: Date | null;
  providerItemId: string | null;
}): boolean {
  return Boolean(
    connection.providerItemId &&
    (connection.status === 'CONNECTED' ||
      connection.status === 'PARTIALLY_AVAILABLE') &&
    connection.consentStatus === 'GRANTED' &&
    (!connection.consentExpiresAt || connection.consentExpiresAt > new Date()),
  );
}

function manuallyRequestable(connection: {
  status: string;
  providerItemId: string | null;
}): boolean {
  return Boolean(
    connection.providerItemId &&
    connection.status !== 'DISCONNECTED' &&
    connection.status !== 'PENDING_AUTHORIZATION',
  );
}
