import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  ImportRun,
  ImportRunSnapshot,
  ImportRunStatus,
} from '../../domain/import-run.js';
import type { IngestionItemState } from '../../domain/ingestion-item.js';
import type { ParsedOfxTransaction } from '../../domain/ofx-statement.js';

export const INGESTION_REPOSITORY = Symbol('INGESTION_REPOSITORY');

export type PreviewedOfxTransaction = ParsedOfxTransaction &
  Readonly<{ isDuplicate: boolean }>;

export type ImportRunDetails = Readonly<{
  run: ImportRunSnapshot;
  items: readonly IngestionItemState[];
}>;

export type CreatePreviewResult = Readonly<{
  created: boolean;
  details: ImportRunDetails;
}>;

export interface IngestionRepository {
  createPreview(
    context: TenantContext,
    run: ImportRun,
    items: readonly PreviewedOfxTransaction[],
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<CreatePreviewResult>;
  findRun(
    context: TenantContext,
    importRunId: string,
  ): Promise<ImportRunDetails | null>;
  startConfirmation(
    context: TenantContext,
    importRunId: string,
    destinationAccountId: string,
    idempotencyKey: string,
    payloadHash: string,
  ): Promise<ImportRunDetails>;
  saveItemResult(
    context: TenantContext,
    importRunId: string,
    ordinal: number,
    result: IngestionItemState,
  ): Promise<void>;
  finishRun(context: TenantContext, importRunId: string): Promise<ImportRunDetails>;
  transitionRun(
    context: TenantContext,
    currentStatus: ImportRunStatus,
    run: ImportRun,
  ): Promise<ImportRunSnapshot>;
}
