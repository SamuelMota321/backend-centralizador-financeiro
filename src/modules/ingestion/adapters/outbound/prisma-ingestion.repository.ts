import { Injectable } from '@nestjs/common';
import {
  ImportRunStatus as PrismaImportRunStatus,
  IngestionItemStatus as PrismaIngestionItemStatus,
  OfxVariant as PrismaOfxVariant,
  Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import {
  ImportRunConflict,
  ImportRunNotFound,
  IngestionIdempotencyKeyExpired,
  IngestionIdempotencyKeyReused,
  IngestionIdempotencyRecordUnavailable,
} from '../../domain/ingestion.errors.js';
import type {
  ImportRun,
  ImportRunSnapshot,
  ImportRunStatus,
} from '../../domain/import-run.js';
import { ImportRun as ImportRunEntity } from '../../domain/import-run.js';
import type { IngestionItemState } from '../../domain/ingestion-item.js';
import type { OfxVariant } from '../../domain/ofx-statement.js';
import type {
  CreatePreviewResult,
  ImportRunDetails,
  IngestionRepository,
  PreviewedOfxTransaction,
} from '../../application/ports/ingestion.repository.port.js';

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

const ingestionItemSelect = {
  ordinal: true,
  externalId: true,
  type: true,
  amount: true,
  occurredOn: true,
  description: true,
  status: true,
  isDuplicate: true,
  warnings: true,
  errorCode: true,
} satisfies Prisma.IngestionItemSelect;

type ImportRunRecord = Prisma.ImportRunGetPayload<{
  select: typeof importRunSelect;
}>;
type IngestionItemRecord = Prisma.IngestionItemGetPayload<{
  select: typeof ingestionItemSelect;
}>;
type RawIdempotencyRecord = Readonly<{
  id: string;
  payload_hash: string;
  status: string;
  resource_ids: unknown;
  expires_at: Date | string;
}>;
type IdempotencyClaim = Readonly<{
  id: string;
  claimed: boolean;
  payloadHash: string;
  status: 'pending' | 'completed';
  resourceIds: readonly string[];
  expiresAt: Date | string;
}>;

const TO_PRISMA_VARIANT: Record<OfxVariant, PrismaOfxVariant> = {
  ofx_1_sgml: PrismaOfxVariant.OFX_1_SGML,
  ofx_2_xml: PrismaOfxVariant.OFX_2_XML,
};

const FROM_PRISMA_VARIANT: Record<PrismaOfxVariant, OfxVariant> = {
  OFX_1_SGML: 'ofx_1_sgml',
  OFX_2_XML: 'ofx_2_xml',
};

const TO_PRISMA_RUN_STATUS: Record<ImportRunStatus, PrismaImportRunStatus> = {
  preview_ready: PrismaImportRunStatus.PREVIEW_READY,
  queued: PrismaImportRunStatus.QUEUED,
  processing: PrismaImportRunStatus.PROCESSING,
  completed: PrismaImportRunStatus.COMPLETED,
  completed_with_errors: PrismaImportRunStatus.COMPLETED_WITH_ERRORS,
  failed: PrismaImportRunStatus.FAILED,
  expired: PrismaImportRunStatus.EXPIRED,
};

const FROM_PRISMA_RUN_STATUS: Record<PrismaImportRunStatus, ImportRunStatus> = {
  PREVIEW_READY: 'preview_ready',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

const TO_PRISMA_ITEM_STATUS: Record<
  IngestionItemState['status'],
  PrismaIngestionItemStatus
> = {
  previewed: PrismaIngestionItemStatus.PREVIEWED,
  imported: PrismaIngestionItemStatus.IMPORTED,
  ignored_duplicate: PrismaIngestionItemStatus.IGNORED_DUPLICATE,
  failed: PrismaIngestionItemStatus.FAILED,
};

const FROM_PRISMA_ITEM_STATUS: Record<
  PrismaIngestionItemStatus,
  IngestionItemState['status']
> = {
  PREVIEWED: 'previewed',
  IMPORTED: 'imported',
  IGNORED_DUPLICATE: 'ignored_duplicate',
  FAILED: 'failed',
};

@Injectable()
export class PrismaIngestionRepository implements IngestionRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  createPreview(
    context: TenantContext,
    run: ImportRun,
    items: readonly PreviewedOfxTransaction[],
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<CreatePreviewResult> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const claim = await claimIdempotency(
        transaction,
        context,
        'ofx_preview_creation',
        idempotencyKey,
        payloadHash,
      );
      if (!claim.claimed) {
        assertReplayableClaim(claim, payloadHash);
        const resourceId = singleResourceId(claim.resourceIds);
        return {
          created: false,
          details: await findRunDetails(transaction, context, resourceId),
        };
      }

      const record = await transaction.importRun.create({
        data: {
          tenantId: context.tenantId,
          destinationAccountId: run.props.destinationAccountId,
          status: PrismaImportRunStatus.PREVIEW_READY,
          variant: TO_PRISMA_VARIANT[run.props.variant],
          fileSizeBytes: run.props.fileSizeBytes,
          contentSha256: run.props.contentSha256,
          sourceObjectReference: run.props.sourceObjectReference,
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
            isDuplicate: item.isDuplicate,
            warnings: [...item.warnings],
          })),
        });
      }
      await completeIdempotency(transaction, context, claim.id, record.id);
      return {
        created: true,
        details: await findRunDetails(transaction, context, record.id),
      };
    });
  }

  findRun(
    context: TenantContext,
    importRunId: string,
  ): Promise<ImportRunDetails | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      try {
        return await findRunDetails(transaction, context, importRunId);
      } catch (error) {
        if (error instanceof ImportRunNotFound) return null;
        throw error;
      }
    });
  }

  startConfirmation(
    context: TenantContext,
    importRunId: string,
    destinationAccountId: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<ImportRunDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const record = await transaction.importRun.findFirst({
        where: { id: importRunId, tenantId: context.tenantId },
        select: importRunSelect,
      });
      if (!record) throw new ImportRunNotFound();
      if (record.destinationAccountId !== destinationAccountId) {
        throw new ImportRunConflict();
      }

      const claim = await claimIdempotency(
        transaction,
        context,
        'ofx_import_confirmation',
        idempotencyKey,
        payloadHash,
      );
      if (claim.claimed) {
        await completeIdempotency(transaction, context, claim.id, importRunId);
      } else {
        assertReplayableClaim(claim, payloadHash);
        if (singleResourceId(claim.resourceIds) !== importRunId) {
          throw new IngestionIdempotencyRecordUnavailable();
        }
      }

      if (record.status === PrismaImportRunStatus.PREVIEW_READY) {
        const updated = await transaction.importRun.updateMany({
          where: {
            id: importRunId,
            tenantId: context.tenantId,
            status: PrismaImportRunStatus.PREVIEW_READY,
          },
          data: {
            status: PrismaImportRunStatus.PROCESSING,
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new ImportRunConflict();
      } else if (
        record.status !== PrismaImportRunStatus.PROCESSING &&
        record.status !== PrismaImportRunStatus.COMPLETED &&
        record.status !== PrismaImportRunStatus.COMPLETED_WITH_ERRORS &&
        record.status !== PrismaImportRunStatus.FAILED
      ) {
        throw new ImportRunConflict();
      }

      return findRunDetails(transaction, context, importRunId);
    });
  }

  async saveItemResult(
    context: TenantContext,
    importRunId: string,
    ordinal: number,
    result: IngestionItemState,
  ): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      await transaction.ingestionItem.updateMany({
        where: {
          tenantId: context.tenantId,
          importRunId,
          ordinal,
          status: PrismaIngestionItemStatus.PREVIEWED,
        },
        data: {
          status: TO_PRISMA_ITEM_STATUS[result.status],
          isDuplicate: result.isDuplicate,
          errorCode: result.errorCode,
          updatedAt: new Date(),
        },
      });
    });
  }

  finishRun(
    context: TenantContext,
    importRunId: string,
  ): Promise<ImportRunDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const details = await findRunDetails(transaction, context, importRunId);
      if (
        details.run.status === 'completed' ||
        details.run.status === 'completed_with_errors' ||
        details.run.status === 'failed'
      ) {
        return details;
      }
      if (details.run.status !== 'processing') throw new ImportRunConflict();

      const counts = details.items.reduce(
        (result, item) => {
          if (item.status === 'imported') result.importedItems += 1;
          if (item.status === 'ignored_duplicate') result.ignoredItems += 1;
          if (item.status === 'failed') result.failedItems += 1;
          if (item.status === 'previewed') throw new ImportRunConflict();
          return result;
        },
        { importedItems: 0, ignoredItems: 0, failedItems: 0 },
      );
      if (details.items.length !== details.run.totalItems) {
        throw new ImportRunConflict();
      }

      const finished = ImportRunEntity.reconstitute(details.run).finish(
        counts,
        new Date().toISOString(),
      );
      const updated = await transaction.importRun.updateMany({
        where: {
          id: importRunId,
          tenantId: context.tenantId,
          status: PrismaImportRunStatus.PROCESSING,
        },
        data: {
          status: TO_PRISMA_RUN_STATUS[finished.props.status],
          importedItems: counts.importedItems,
          ignoredItems: counts.ignoredItems,
          failedItems: counts.failedItems,
          terminalAt: new Date(finished.props.terminalAt!),
          retentionExpiresAt: new Date(finished.props.retentionExpiresAt!),
          updatedAt: new Date(finished.props.updatedAt),
        },
      });
      if (updated.count !== 1) {
        const current = await findRunDetails(transaction, context, importRunId);
        if (
          current.run.status === 'completed' ||
          current.run.status === 'completed_with_errors' ||
          current.run.status === 'failed'
        ) {
          return current;
        }
        throw new ImportRunConflict();
      }
      return findRunDetails(transaction, context, importRunId);
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
          status: TO_PRISMA_RUN_STATUS[currentStatus],
        },
        data: {
          status: TO_PRISMA_RUN_STATUS[run.props.status],
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

async function findRunDetails(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  importRunId: string,
): Promise<ImportRunDetails> {
  const record = await transaction.importRun.findFirst({
    where: { id: importRunId, tenantId: context.tenantId },
    select: importRunSelect,
  });
  if (!record) throw new ImportRunNotFound();
  const items = await transaction.ingestionItem.findMany({
    where: { importRunId: record.id, tenantId: context.tenantId },
    orderBy: { ordinal: 'asc' },
    select: ingestionItemSelect,
  });
  return {
    run: toImportRunSnapshot(record),
    items: items.map(toIngestionItemState),
  };
}

async function claimIdempotency(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  operation: 'ofx_preview_creation' | 'ofx_import_confirmation',
  key: string,
  payloadHash: string,
): Promise<IdempotencyClaim> {
  const inserted = await transaction.$queryRaw<RawIdempotencyRecord[]>`
    INSERT INTO public.idempotency_keys (
      tenant_id, operation, key, payload_hash, status, resource_ids,
      created_at, expires_at
    )
    VALUES (
      ${context.tenantId}::uuid, ${operation}, ${key}, ${payloadHash},
      'pending'::public.idempotency_status, '[]'::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '24 hours'
    )
    ON CONFLICT (tenant_id, operation, key) DO NOTHING
    RETURNING id, payload_hash, status, resource_ids, expires_at
  `;
  if (inserted[0]) {
    return { ...toIdempotencyClaim(inserted[0]), claimed: true };
  }

  const records = await transaction.$queryRaw<RawIdempotencyRecord[]>`
    SELECT id, payload_hash, status, resource_ids, expires_at
    FROM public.idempotency_keys
    WHERE tenant_id = ${context.tenantId}::uuid
      AND operation = ${operation}
      AND key = ${key}
    LIMIT 1
  `;
  if (!records[0]) throw new IngestionIdempotencyRecordUnavailable();
  return { ...toIdempotencyClaim(records[0]), claimed: false };
}

function toIdempotencyClaim(record: RawIdempotencyRecord): Omit<IdempotencyClaim, 'claimed'> {
  if (record.status !== 'pending' && record.status !== 'completed') {
    throw new IngestionIdempotencyRecordUnavailable();
  }
  const resourceIds = readResourceIds(record.resource_ids);
  return {
    id: record.id,
    payloadHash: record.payload_hash,
    status: record.status,
    resourceIds,
    expiresAt: record.expires_at,
  };
}

function assertReplayableClaim(
  claim: IdempotencyClaim,
  payloadHash: string,
): void {
  if (new Date(claim.expiresAt).getTime() <= Date.now()) {
    throw new IngestionIdempotencyKeyExpired();
  }
  if (claim.status !== 'completed') {
    throw new IngestionIdempotencyRecordUnavailable();
  }
  if (claim.payloadHash !== payloadHash) {
    throw new IngestionIdempotencyKeyReused();
  }
}

function singleResourceId(resourceIds: readonly string[]): string {
  if (
    resourceIds.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      resourceIds[0] ?? '',
    )
  ) {
    throw new IngestionIdempotencyRecordUnavailable();
  }
  return resourceIds[0]!.toLowerCase();
}

async function completeIdempotency(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  id: string,
  resourceId: string,
): Promise<void> {
  const updated = await transaction.$executeRaw`
    UPDATE public.idempotency_keys
    SET status = 'completed'::public.idempotency_status,
        resource_ids = ${JSON.stringify([resourceId])}::jsonb
    WHERE id = ${id}::uuid
      AND tenant_id = ${context.tenantId}::uuid
      AND status = 'pending'::public.idempotency_status
  `;
  if (updated !== 1) throw new IngestionIdempotencyRecordUnavailable();
}

function readResourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new IngestionIdempotencyRecordUnavailable();
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function toImportRunSnapshot(record: ImportRunRecord): ImportRunSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    destinationAccountId: record.destinationAccountId,
    status: FROM_PRISMA_RUN_STATUS[record.status],
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

function toIngestionItemState(record: IngestionItemRecord): IngestionItemState {
  return {
    ordinal: record.ordinal,
    externalId: record.externalId,
    type: record.type === 'INCOME' ? 'income' : 'expense',
    amount: record.amount.toFixed(2),
    occurredOn: record.occurredOn.toISOString().slice(0, 10),
    description: record.description,
    status: FROM_PRISMA_ITEM_STATUS[record.status],
    isDuplicate: record.isDuplicate,
    warnings: readWarnings(record.warnings),
    errorCode: record.errorCode,
  };
}

function readWarnings(value: Prisma.JsonValue): IngestionItemState['warnings'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (warning): warning is 'external_id_missing' =>
      warning === 'external_id_missing',
  );
}
