import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { ImportRun, ImportRunSnapshot } from '../../domain/import-run.js';
import type { ParsedOfxTransaction } from '../../domain/ofx-statement.js';

export const INGESTION_REPOSITORY = Symbol('INGESTION_REPOSITORY');

export interface IngestionRepository {
  createPreview(
    context: TenantContext,
    run: ImportRun,
    items: readonly ParsedOfxTransaction[],
  ): Promise<ImportRunSnapshot>;
  findRun(
    context: TenantContext,
    importRunId: string,
  ): Promise<ImportRunSnapshot | null>;
  transitionRun(
    context: TenantContext,
    currentStatus: ImportRunSnapshot['status'],
    run: ImportRun,
  ): Promise<ImportRunSnapshot>;
}
