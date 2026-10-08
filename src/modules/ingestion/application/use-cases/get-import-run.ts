import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { ImportRunNotFound } from '../../domain/ingestion.errors.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';

export class GetImportRun {
  constructor(private readonly repository: IngestionRepository) {}

  async execute(context: TenantContext, importRunId: string) {
    assertTenantContext(context);
    const details = await this.repository.findRun(context, importRunId);
    if (!details) throw new ImportRunNotFound();
    return details;
  }
}
