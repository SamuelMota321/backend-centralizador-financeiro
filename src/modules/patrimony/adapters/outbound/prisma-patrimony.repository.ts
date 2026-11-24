import { Injectable } from '@nestjs/common';
import type {
  Financing,
  FinancingRevision,
  Liability,
  LiabilityRevision,
  PatrimonialAsset,
  PatrimonialAssetRevision,
  Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { PrismaAuditWriter } from '../../../audit/adapters/outbound/prisma-audit-writer.js';
import type {
  AssetData,
  DebtData,
  FinancingData,
  PatrimonyData,
  PatrimonyKind,
} from '../../domain/patrimony.js';
import type {
  PatrimonyPage,
  PatrimonyRepository,
  PatrimonyView,
  RevisionView,
  TenantPatrimonyRepository,
} from '../../application/ports/patrimony.repository.port.js';

@Injectable()
export class PrismaPatrimonyRepository implements PatrimonyRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  withTenant<Result>(
    context: TenantContext,
    operation: (
      scope: Readonly<{
        records: TenantPatrimonyRepository;
        audit: PrismaAuditWriter;
      }>,
    ) => Promise<Result>,
  ): Promise<Result> {
    return this.tenantTransaction.run(context, (transaction) =>
      operation({
        records: new TenantRecords(transaction, context.tenantId),
        audit: new PrismaAuditWriter(transaction),
      }),
    );
  }
}

class TenantRecords implements TenantPatrimonyRepository {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async create(
    kind: PatrimonyKind,
    data: PatrimonyData,
  ): Promise<PatrimonyView> {
    if (kind === 'asset') {
      const asset = data as AssetData;
      return assetView(
        await this.tx.patrimonialAsset.create({
          data: {
            tenantId: this.tenantId,
            type: asset.type,
            description: asset.description,
            estimatedValue: asset.estimatedValue,
            valuationDate: dbDate(asset.valuationDate),
            source: asset.source,
          },
        }),
      );
    }
    if (kind === 'financing') {
      const financing = data as FinancingData;
      return financingView(
        await this.tx.financing.create({
          data: {
            tenantId: this.tenantId,
            description: financing.description,
            outstandingBalance: financing.outstandingBalance,
            assetId: financing.assetId,
          },
        }),
      );
    }
    const liability = data as DebtData;
    return liabilityView(
      await this.tx.liability.create({
        data: {
          tenantId: this.tenantId,
          description: liability.description,
          outstandingBalance: liability.outstandingBalance,
        },
      }),
    );
  }

  async find(kind: PatrimonyKind, id: string): Promise<PatrimonyView | null> {
    if (kind === 'asset') {
      const row = await this.tx.patrimonialAsset.findFirst({
        where: { id, tenantId: this.tenantId },
      });
      return row ? assetView(row) : null;
    }
    if (kind === 'financing') {
      const row = await this.tx.financing.findFirst({
        where: { id, tenantId: this.tenantId },
      });
      return row ? financingView(row) : null;
    }
    const row = await this.tx.liability.findFirst({
      where: { id, tenantId: this.tenantId },
    });
    return row ? liabilityView(row) : null;
  }

  async findForUpdate(
    kind: PatrimonyKind,
    id: string,
  ): Promise<PatrimonyView | null> {
    if (kind === 'asset') {
      await this.tx
        .$queryRaw`SELECT id FROM public.patrimonial_assets WHERE tenant_id = ${this.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    } else if (kind === 'financing') {
      await this.tx
        .$queryRaw`SELECT id FROM public.financing WHERE tenant_id = ${this.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    } else {
      await this.tx
        .$queryRaw`SELECT id FROM public.liabilities WHERE tenant_id = ${this.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    return this.find(kind, id);
  }

  async list(
    kind: PatrimonyKind,
    page: number,
    pageSize: number,
  ): Promise<PatrimonyPage> {
    const total =
      kind === 'asset'
        ? await this.tx.patrimonialAsset.count({
            where: { tenantId: this.tenantId },
          })
        : kind === 'financing'
          ? await this.tx.financing.count({
              where: { tenantId: this.tenantId },
            })
          : await this.tx.liability.count({
              where: { tenantId: this.tenantId },
            });
    const offset = BigInt(page - 1) * BigInt(pageSize);
    if (offset >= BigInt(total)) return { items: [], page, pageSize, total };
    const skip = Number(offset);
    if (kind === 'asset') {
      const rows = await this.tx.patrimonialAsset.findMany({
        where: { tenantId: this.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      });
      return { items: rows.map(assetView), page, pageSize, total };
    }
    if (kind === 'financing') {
      const rows = await this.tx.financing.findMany({
        where: { tenantId: this.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
      });
      return { items: rows.map(financingView), page, pageSize, total };
    }
    const rows = await this.tx.liability.findMany({
      where: { tenantId: this.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
    });
    return { items: rows.map(liabilityView), page, pageSize, total };
  }

  async update(
    kind: PatrimonyKind,
    id: string,
    data: PatrimonyData,
    version: number,
  ): Promise<PatrimonyView> {
    if (kind === 'asset') {
      const asset = data as AssetData;
      await this.tx.patrimonialAsset.updateMany({
        where: { id, tenantId: this.tenantId },
        data: {
          type: asset.type,
          description: asset.description,
          estimatedValue: asset.estimatedValue,
          valuationDate: dbDate(asset.valuationDate),
          source: asset.source,
          version,
        },
      });
    } else if (kind === 'financing') {
      const financing = data as FinancingData;
      await this.tx.financing.updateMany({
        where: { id, tenantId: this.tenantId },
        data: {
          description: financing.description,
          outstandingBalance: financing.outstandingBalance,
          assetId: financing.assetId,
          version,
        },
      });
    } else {
      const liability = data as DebtData;
      await this.tx.liability.updateMany({
        where: { id, tenantId: this.tenantId },
        data: {
          description: liability.description,
          outstandingBalance: liability.outstandingBalance,
          version,
        },
      });
    }
    const view = await this.find(kind, id);
    if (!view) throw new Error('Patrimony update lost the owned row.');
    return view;
  }

  async addRevision(
    view: PatrimonyView,
    actorUserId: string,
    requestId: string,
  ): Promise<void> {
    if (view.kind === 'asset') {
      await this.tx.patrimonialAssetRevision.create({
        data: {
          tenantId: this.tenantId,
          assetId: view.id,
          version: view.version,
          type: view.type,
          description: view.description,
          estimatedValue: view.estimatedValue,
          valuationDate: dbDate(view.valuationDate),
          source: view.source,
          actorUserId,
          requestId,
        },
      });
    } else if (view.kind === 'financing') {
      await this.tx.financingRevision.create({
        data: {
          tenantId: this.tenantId,
          financingId: view.id,
          version: view.version,
          description: view.description,
          outstandingBalance: view.outstandingBalance,
          assetId: view.assetId,
          actorUserId,
          requestId,
        },
      });
    } else {
      await this.tx.liabilityRevision.create({
        data: {
          tenantId: this.tenantId,
          liabilityId: view.id,
          version: view.version,
          description: view.description,
          outstandingBalance: view.outstandingBalance,
          actorUserId,
          requestId,
        },
      });
    }
  }

  async history(kind: PatrimonyKind, id: string): Promise<RevisionView[]> {
    if (kind === 'asset') {
      return (
        await this.tx.patrimonialAssetRevision.findMany({
          where: { tenantId: this.tenantId, assetId: id },
          orderBy: { version: 'desc' },
        })
      ).map(assetRevisionView);
    }
    if (kind === 'financing') {
      return (
        await this.tx.financingRevision.findMany({
          where: { tenantId: this.tenantId, financingId: id },
          orderBy: { version: 'desc' },
        })
      ).map(financingRevisionView);
    }
    return (
      await this.tx.liabilityRevision.findMany({
        where: { tenantId: this.tenantId, liabilityId: id },
        orderBy: { version: 'desc' },
      })
    ).map(liabilityRevisionView);
  }

  async assetExists(id: string): Promise<boolean> {
    return !!(await this.tx.patrimonialAsset.findFirst({
      where: { id, tenantId: this.tenantId },
      select: { id: true },
    }));
  }
}

function dbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function baseView(row: {
  id: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    currencyCode: 'BRL' as const,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function assetView(row: PatrimonialAsset): PatrimonyView {
  return {
    ...baseView(row),
    kind: 'asset',
    type: row.type,
    description: row.description,
    estimatedValue: row.estimatedValue.toFixed(2),
    valuationDate: isoDate(row.valuationDate),
    source: row.source,
  };
}
function financingView(row: Financing): PatrimonyView {
  return {
    ...baseView(row),
    kind: 'financing',
    description: row.description,
    outstandingBalance: row.outstandingBalance.toFixed(2),
    assetId: row.assetId,
  };
}
function liabilityView(row: Liability): PatrimonyView {
  return {
    ...baseView(row),
    kind: 'liability',
    description: row.description,
    outstandingBalance: row.outstandingBalance.toFixed(2),
  };
}
function revisionBase(row: {
  version: number;
  actorUserId: string;
  requestId: string;
  createdAt: Date;
}) {
  return {
    version: row.version,
    actorUserId: row.actorUserId,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}
function assetRevisionView(row: PatrimonialAssetRevision): RevisionView {
  return {
    ...revisionBase(row),
    state: {
      type: row.type,
      description: row.description,
      estimatedValue: row.estimatedValue.toFixed(2),
      valuationDate: isoDate(row.valuationDate),
      source: row.source,
    },
  };
}
function financingRevisionView(row: FinancingRevision): RevisionView {
  return {
    ...revisionBase(row),
    state: {
      description: row.description,
      outstandingBalance: row.outstandingBalance.toFixed(2),
      assetId: row.assetId,
    },
  };
}
function liabilityRevisionView(row: LiabilityRevision): RevisionView {
  return {
    ...revisionBase(row),
    state: {
      description: row.description,
      outstandingBalance: row.outstandingBalance.toFixed(2),
    },
  };
}
