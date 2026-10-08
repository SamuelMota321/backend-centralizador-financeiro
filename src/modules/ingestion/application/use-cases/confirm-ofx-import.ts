import { createHash } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { IngestionItem } from '../../domain/ingestion-item.js';
import { IngestionObjectStoreUnavailable } from '../../domain/ingestion.errors.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import type { OfxSourceObjectStore } from '../ports/ofx-source-object-store.port.js';
import type { OfxTransactionImporter } from '../ports/ofx-transaction-importer.port.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../../../transactions/application/transactions.errors.js';

export class ConfirmOfxImport {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly importer: OfxTransactionImporter,
    private readonly sourceObjectStore: OfxSourceObjectStore,
  ) {}

  async execute(
    context: TenantContext,
    importRunId: string,
    destinationAccountId: string,
    idempotencyKey: string,
  ) {
    assertTenantContext(context);
    const canonicalRunId = importRunId.toLowerCase();
    const canonicalAccountId = destinationAccountId.toLowerCase();
    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          importRunId: canonicalRunId,
          destinationAccountId: canonicalAccountId,
        }),
      )
      .digest('hex');
    const started = await this.repository.startConfirmation(
      context,
      canonicalRunId,
      canonicalAccountId,
      idempotencyKey,
      payloadHash,
    );

    let details = started;
    if (started.run.status === 'preview_ready' || started.run.status === 'processing') {
      for (const item of started.items) {
        if (item.status !== 'previewed') continue;
        const pending = IngestionItem.preview({
          ordinal: item.ordinal,
          externalId: item.externalId,
          type: item.type,
          amount: item.amount,
          occurredOn: item.occurredOn,
          description: item.description,
          isDuplicate: item.isDuplicate ?? false,
          warnings: item.warnings,
        });
        try {
          const imported = await this.importer.import(context, {
            accountId: canonicalAccountId,
            externalId: item.externalId,
            type: item.type,
            amount: item.amount,
            occurredOn: item.occurredOn,
            description: item.description,
          });
          const completed =
            imported.disposition === 'imported'
              ? pending.markImported()
              : pending.markIgnoredDuplicate();
          await this.repository.saveItemResult(
            context,
            canonicalRunId,
            item.ordinal,
            completed.props,
          );
        } catch (error) {
          const errorCode = knownItemErrorCode(error);
          if (!errorCode) throw error;
          const failed = pending.markFailed(errorCode);
          await this.repository.saveItemResult(
            context,
            canonicalRunId,
            item.ordinal,
            failed.props,
          );
        }
      }
      details = await this.repository.finishRun(context, canonicalRunId);
    }

    if (
      details.run.status === 'completed' ||
      details.run.status === 'completed_with_errors' ||
      details.run.status === 'failed' ||
      details.run.status === 'expired'
    ) {
      const sourceObjectReference = details.run.sourceObjectReference;
      if (!sourceObjectReference) throw new IngestionObjectStoreUnavailable();
      await this.sourceObjectStore.delete(sourceObjectReference);
    }
    return details;
  }
}

function knownItemErrorCode(error: unknown): string | null {
  if (error instanceof TransactionAccountNotFound) return 'account_not_found';
  if (error instanceof TransactionAccountArchived) return 'account_archived';
  if (error instanceof InvalidTransactionRequest) return 'invalid_request';
  return null;
}
