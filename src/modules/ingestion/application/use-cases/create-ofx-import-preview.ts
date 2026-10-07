import { createHash } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { ImportRun } from '../../domain/import-run.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import type { OfxParser } from '../ports/ofx-parser.port.js';

export class CreateOfxImportPreview {
  constructor(
    private readonly parser: OfxParser,
    private readonly repository: IngestionRepository,
  ) {}

  async execute(context: TenantContext, content: Uint8Array) {
    assertTenantContext(context);
    const parsed = this.parser.parse(content);
    const run = ImportRun.createPreview({
      tenantId: context.tenantId,
      variant: parsed.variant,
      fileSizeBytes: content.byteLength,
      contentSha256: createHash('sha256').update(content).digest('hex'),
      totalItems: parsed.transactions.length,
      now: new Date().toISOString(),
    });
    return this.repository.createPreview(context, run, parsed.transactions);
  }
}
