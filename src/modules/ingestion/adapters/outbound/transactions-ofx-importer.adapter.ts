import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { ImportOfxTransaction } from '../../../transactions/application/use-cases/import-ofx-transaction.js';
import type {
  OfxTransactionImportInput,
  OfxTransactionImportResult,
  OfxTransactionImporter,
} from '../../application/ports/ofx-transaction-importer.port.js';

@Injectable()
export class TransactionsOfxImporterAdapter implements OfxTransactionImporter {
  constructor(private readonly importOfxTransaction: ImportOfxTransaction) {}

  import(
    context: TenantContext,
    input: OfxTransactionImportInput,
  ): Promise<OfxTransactionImportResult> {
    return this.importOfxTransaction.execute(context, input);
  }
}
