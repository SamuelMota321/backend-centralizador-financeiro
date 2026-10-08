import { createHash, randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { ImportRun } from '../../domain/import-run.js';
import {
  InvalidOfxDestinationAccount,
} from '../../domain/ingestion.errors.js';
import {
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../../../transactions/application/transactions.errors.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import type { OfxAccountOwnership } from '../ports/ofx-account-ownership.port.js';
import type { OfxParser } from '../ports/ofx-parser.port.js';
import type { OfxSourceObjectStore } from '../ports/ofx-source-object-store.port.js';
import type { FindOfxTransactionDuplicates } from '../../../transactions/application/use-cases/find-ofx-transaction-duplicates.js';

export class CreateOfxImportPreview {
  constructor(
    private readonly parser: OfxParser,
    private readonly repository: IngestionRepository,
    private readonly accountOwnership: OfxAccountOwnership,
    private readonly findDuplicates: FindOfxTransactionDuplicates,
    private readonly sourceObjectStore: OfxSourceObjectStore,
  ) {}

  async execute(
    context: TenantContext,
    content: Uint8Array,
    destinationAccountId: string,
    idempotencyKey: string,
  ) {
    assertTenantContext(context);
    const parsed = this.parser.parse(content);
    const canonicalAccountId = destinationAccountId.toLowerCase();
    const accountState = await this.accountOwnership.getOwnedState(
      context,
      canonicalAccountId,
    );
    if (accountState === 'missing') throw new TransactionAccountNotFound();
    if (accountState === 'archived_local') {
      throw new TransactionAccountArchived();
    }
    if (accountState !== 'active_local') {
      throw new InvalidOfxDestinationAccount();
    }

    const duplicates = await this.findDuplicates.execute(
      context,
      canonicalAccountId,
      parsed.transactions,
    );
    const contentSha256 = createHash('sha256')
      .update(content)
      .digest('hex');
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          destinationAccountId: canonicalAccountId,
          contentSha256,
        }),
      )
      .digest('hex');
    const sourceObjectReference = `ofx/${context.tenantId}/${randomUUID()}.ofx`;
    await this.sourceObjectStore.put(sourceObjectReference, content);

    const run = ImportRun.createPreview({
      tenantId: context.tenantId,
      destinationAccountId: canonicalAccountId,
      variant: parsed.variant,
      fileSizeBytes: content.byteLength,
      contentSha256,
      sourceObjectReference,
      totalItems: parsed.transactions.length,
      now: new Date().toISOString(),
    });

    try {
      const result = await this.repository.createPreview(
        context,
        run,
        parsed.transactions.map((item, index) => ({
          ...item,
          isDuplicate: duplicates[index] ?? false,
        })),
        idempotencyKey,
        payloadHash,
      );
      if (!result.created) {
        await this.sourceObjectStore.delete(sourceObjectReference);
      }
      return result.details;
    } catch (error) {
      try {
        await this.sourceObjectStore.delete(sourceObjectReference);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Preview persistence and source cleanup both failed.',
        );
      }
      throw error;
    }
  }
}
