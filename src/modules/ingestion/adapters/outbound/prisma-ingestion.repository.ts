import { Injectable } from '@nestjs/common';
import {
  ImportRunStatus as PrismaImportRunStatus,
  IngestionItemStatus as PrismaIngestionItemStatus,
  OfxVariant as PrismaOfxVariant,
  Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import {
  ImportRunConflict,
  ImportRunNotFound,
} from '../../domain/ingestion.errors.js';
import type {
  ImportRun,
  ImportRunSnapshot,
  ImportRunStatus,
} from '../../domain/import-run.js';
import type {
  OfxVariant,
  ParsedOfxTransaction,
} from '../../domain/ofx-statement.js';
import type { IngestionRepository } from '../../application/ports/ingestion.repository.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';

const importRunSelect = {
  id: true,
  tenantId: true,
  destinationAccountId: true,
  status: true,
  variant: true,
  fileSizeBytes: true,
  contentSha256: true,
  sourceObjectReference: true,
  totalItems: true,
  importedItems: true,
  ignoredItems: true,
  failedItems: true,
  terminalAt: true,
  retentionExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ImportRunSelect;

type ImportRunRecord = Prisma.ImportRunGetPayload<{
  select: typeof importRunSelect;
}>;

const TO_PRISMA_VARIANT: Record<OfxVariant, PrismaOfxVariant> = {
  ofx_1_sgml: PrismaOfxVariant.OFX_1_SGML,
  ofx_2_xml: PrismaOfxVariant.OFX_2_XML,
};

const FROM_PRISMA_VARIANT: Record<PrismaOfxVariant, OfxVariant> = {
  OFX_1_SGML: 'ofx_1_sgml',
  OFX_2_XML: 'ofx_2_xml',
};

const TO_PRISMA_STATUS: Record<ImportRunStatus, PrismaImportRunStatus> = {
  preview_ready: PrismaImportRunStatus.PREVIEW_READY,
  queued: PrismaImportRunStatus.QUEUED,
  processing: PrismaImportRunStatus.PROCESSING,
  completed: PrismaImportRunStatus.COMPLETED,
  completed_with_errors: PrismaImportRunStatus.COMPLETED_WITH_ERRORS,
  failed: PrismaImportRunStatus.FAILED,
  expired: PrismaImportRunStatus.EXPIRED,
};

const FROM_PRISMA_STATUS: Record<PrismaImportRunStatus, ImportRunStatus> = {
  PREVIEW_READY: 'preview_ready',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

@Injectable()
export class PrismaIngestionRepository implements IngestionRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  createPreview(
    context: TenantContext,
    run: ImportRun,
    items: readonly ParsedOfxTransaction[],
  ): Promise<ImportRunSnapshot> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const record = await transaction.importRun.create({
        data: {
          tenantId: context.tenantId,
          status: PrismaImportRunStatus.PREVIEW_READY,
          variant: TO_PRISMA_VARIANT[run.props.variant],
          fileSizeBytes: run.props.fileSizeBytes,
          contentSha256: run.props.contentSha256,
          totalItems: run.props.totalItems,
          updatedAt: new Date(run.props.updatedAt),
        },
        select: importRunSelect,
      });
      if (items.length > 0) {
        await transaction.ingestionItem.createMany({
          data: items.map((item) => ({
            tenantId: context.tenantId,
            importRunId: record.id,
            ordinal: item.ordinal,
            externalId: item.externalId,
            type: item.type === 'income' ? 'INCOME' : 'EXPENSE',
            amount: item.amount,
            occurredOn: new Date(`${item.occurredOn}T00:00:00.000Z`),
            description: item.description,
            status: PrismaIngestionItemStatus.PREVIEWED,
            warnings: [...item.warnings],
          })),
        });
      }
      return toImportRunSnapshot(record);
    });
  }

  findRun(
    context: TenantContext,
    importRunId: string,
  ): Promise<ImportRunSnapshot | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const record = await transaction.importRun.findFirst({
        where: { id: importRunId, tenantId: context.tenantId },
        select: importRunSelect,
      });
      return record ? toImportRunSnapshot(record) : null;
    });
  }

  transitionRun(
    context: TenantContext,
    currentStatus: ImportRunStatus,
    run: ImportRun,
  ): Promise<ImportRunSnapshot> {
    const id = run.props.id;
    if (!id) throw new ImportRunNotFound();
    return this.tenantTransaction.run(context, async (transaction) => {
      const updated = await transaction.importRun.updateMany({
        where: {
          id,
          tenantId: context.tenantId,
          status: TO_PRISMA_STATUS[currentStatus],
        },
        data: {
          status: TO_PRISMA_STATUS[run.props.status],
          terminalAt: run.props.terminalAt
            ? new Date(run.props.terminalAt)
            : null,
          retentionExpiresAt: run.props.retentionExpiresAt
            ? new Date(run.props.retentionExpiresAt)
            : null,
          updatedAt: new Date(run.props.updatedAt),
        },
      });
      if (updated.count !== 1) throw new ImportRunConflict();
      const record = await transaction.importRun.findFirst({
        where: { id, tenantId: context.tenantId },
        select: importRunSelect,
      });
      if (!record) throw new ImportRunNotFound();
      return toImportRunSnapshot(record);
    });
  }
}

function toImportRunSnapshot(record: ImportRunRecord): ImportRunSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    destinationAccountId: record.destinationAccountId,
    status: FROM_PRISMA_STATUS[record.status],
    variant: FROM_PRISMA_VARIANT[record.variant],
    fileSizeBytes: record.fileSizeBytes,
    contentSha256: record.contentSha256.trim(),
    sourceObjectReference: record.sourceObjectReference,
    totalItems: record.totalItems,
    importedItems: record.importedItems,
    ignoredItems: record.ignoredItems,
    failedItems: record.failedItems,
    terminalAt: record.terminalAt?.toISOString() ?? null,
    retentionExpiresAt: record.retentionExpiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
