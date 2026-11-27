import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { ImportOfxTransaction } from '../../../transactions/application/use-cases/import-ofx-transaction.js';
import type {
  OfxTransactionBatchOutcome,
  OfxTransactionImportInput,
  OfxTransactionImporter,
} from '../../application/ports/ofx-transaction-importer.port.js';

@Injectable()
export class TransactionsOfxImporterAdapter implements OfxTransactionImporter {
  constructor(private readonly importOfxTransaction: ImportOfxTransaction) {}

  importMany(
    context: TenantContext,
    inputs: readonly OfxTransactionImportInput[],
  ): Promise<OfxTransactionBatchOutcome[]> {
    return this.importOfxTransaction.executeMany(context, inputs);
  }
}
