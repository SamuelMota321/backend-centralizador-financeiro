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

/** Linhas por transacao. Abaixo do limite de 5 s da transacao interativa, com folga para banco remoto. */
const IMPORT_BATCH_SIZE = 25;

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
      const pendingItems = started.items.filter(
        (item) => item.status === 'previewed',
      );
      // Lotes pequenos: cada um e uma transacao do banco, que tem tempo maximo. O progresso fica
      // gravado a cada lote, entao uma nova tentativa continua de onde parou.
      for (let from = 0; from < pendingItems.length; from += IMPORT_BATCH_SIZE) {
        const batch = pendingItems.slice(from, from + IMPORT_BATCH_SIZE);
        const outcomes = await this.importer.importMany(
          context,
          batch.map((item) => ({
            accountId: canonicalAccountId,
            externalId: item.externalId,
            type: item.type,
            amount: item.amount,
            occurredOn: item.occurredOn,
            description: item.description,
          })),
        );
        const completed = batch.map((item, index) => {
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
          const outcome = outcomes[index];
          if (!outcome) throw new Error('The importer returned fewer outcomes than lines.');
          if (outcome.disposition === 'failed') {
            return pending.markFailed(outcome.errorCode).props;
          }
          return outcome.disposition === 'imported'
            ? pending.markImported().props
            : pending.markIgnoredDuplicate().props;
        });
        await this.repository.saveItemResults(context, canonicalRunId, completed);
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
