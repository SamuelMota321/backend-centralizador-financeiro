import { Injectable } from '@nestjs/common';
import {
  ConnectionProvider,
  ConnectionStatus,
  ConsentStatus,
  PluggySyncRunStatus,
  type FinancialConnection,
  type PluggyInvestment,
  type Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  CollectionRecord,
  InvestmentReadRepository,
  PositionRecord,
} from '../../application/ports/investment-read.port.js';

@Injectable()
export class PrismaInvestmentReadRepository implements InvestmentReadRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  collections(context: TenantContext): Promise<readonly CollectionRecord[]> {
    return this.tenantTransaction.run(context, async (tx) => {
      const connections = await tx.financialConnection.findMany({
        where: {
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          provider: ConnectionProvider.PLUGGY,
        },
        orderBy: { id: 'asc' },
      });
      const result: CollectionRecord[] = [];
      for (const connection of connections) {
        result.push(await readCollection(tx, connection));
      }
      return result;
    });
  }

  movements(context: TenantContext, positionId: string) {
    return this.tenantTransaction.run(context, async (tx) => {
      const row = await tx.pluggyInvestment.findFirst({
        where: { id: positionId, tenantId: context.tenantId },
      });
      if (!row) return null;
      const connection = await tx.financialConnection.findFirst({
        where: {
          id: row.connectionId,
          tenantId: context.tenantId,
          ownerUserId: context.userId,
          provider: ConnectionProvider.PLUGGY,
        },
      });
      if (!connection) return null;
      const collection = await readCollection(tx, connection);
      const position = collection.positions.find((item) => item.id === row.id);
      if (!position) return null;
      const movements = collection.movementsComplete
        ? await tx.pluggyInvestmentMovement.findMany({
            where: {
              tenantId: context.tenantId,
              connectionId: connection.id,
              investmentId: row.id,
              lastSeenRunId: collection.completeRunId,
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
          })
        : [];
      return {
        collection,
        position,
        movements: movements.map((movement) => ({
          id: movement.id,
          externalId: movement.providerId,
          type: movement.type,
          amount: movement.amount?.toString() ?? null,
          occurredAt: movement.occurredAt,
        })),
      };
    });
  }
}

async function readCollection(
  tx: Prisma.TransactionClient,
  connection: FinancialConnection,
): Promise<CollectionRecord> {
  const authorized =
    (connection.status === ConnectionStatus.CONNECTED ||
      connection.status === ConnectionStatus.PARTIALLY_AVAILABLE) &&
    connection.consentStatus === ConsentStatus.GRANTED &&
    !connection.consentRevokedAt &&
    (!connection.consentExpiresAt ||
      connection.consentExpiresAt > new Date()) &&
    ['INVESTMENTS', 'INVESTMENTS_TRANSACTIONS'].every((product) =>
      connection.consentProducts.includes(product),
    );
  if (!authorized) {
    return {
      connectionId: connection.id,
      authorized: false,
      latestRunId: null,
      completeRunId: null,
      movementsComplete: false,
      positions: [],
    };
  }
  const latest = await tx.pluggySyncRun.findFirst({
    where: { tenantId: connection.tenantId, connectionId: connection.id },
    orderBy: { acceptedAt: 'desc' },
  });
  const complete = await tx.pluggySyncRun.findFirst({
    where: {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      investmentsComplete: true,
      status: {
        in: [PluggySyncRunStatus.SUCCEEDED, PluggySyncRunStatus.PARTIAL],
      },
    },
    orderBy: { completedAt: 'desc' },
  });
  const positions = await tx.pluggyInvestment.findMany({
    where: {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      lastSeenRunId: complete?.id ?? null,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return {
    connectionId: connection.id,
    authorized: true,
    latestRunId: latest?.id ?? null,
    completeRunId: complete?.id ?? null,
    movementsComplete:
      Boolean(complete?.movementsComplete) && latest?.id === complete?.id,
    positions: positions.map(toPosition),
  };
}

function toPosition(row: PluggyInvestment): PositionRecord {
  return {
    id: row.id,
    connectionId: row.connectionId,
    externalId: row.providerId,
    name: row.name,
    assetType: row.type,
    subtype: row.subtype,
    providerStatus: row.status,
    currencyCode: row.currencyCode,
    balance: row.balance.toString(),
    quantity: row.quantity?.toString() ?? null,
    investedAmount: row.amountOriginal?.toString() ?? null,
    resultAmount: row.amountProfit?.toString() ?? null,
    institutionName: row.institutionName,
    referenceDate: row.referenceDate,
    rate: row.rate?.toString() ?? null,
    rateType: row.rateType,
    fixedAnnualRate: row.fixedAnnualRate?.toString() ?? null,
    maturityDate: row.maturityDate,
    lastSeenRunId: row.lastSeenRunId,
  };
}
