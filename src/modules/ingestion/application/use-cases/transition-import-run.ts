import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { ImportRun, type ImportRunStatus } from '../../domain/import-run.js';
import { ImportRunNotFound } from '../../domain/ingestion.errors.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';

export class TransitionImportRun {
  constructor(private readonly repository: IngestionRepository) {}

  async execute(
    context: TenantContext,
    importRunId: string,
    nextStatus: ImportRunStatus,
    now: string = new Date().toISOString(),
  ) {
    assertTenantContext(context);
    const snapshot = await this.repository.findRun(context, importRunId);
    if (!snapshot) throw new ImportRunNotFound();
    const run = ImportRun.reconstitute(snapshot).transition(nextStatus, now);
    return this.repository.transitionRun(context, snapshot.status, run);
  }
}
