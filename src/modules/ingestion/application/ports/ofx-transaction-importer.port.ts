import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const OFX_TRANSACTION_IMPORTER = Symbol('OFX_TRANSACTION_IMPORTER');

export type OfxTransactionImportInput = Readonly<{
  accountId: string;
  type: 'income' | 'expense';
  amount: string;
  occurredOn: string;
  description: string | null;
  externalId: string | null;
}>;

export type OfxTransactionImportResult =
  | Readonly<{ disposition: 'imported'; transactionId: string }>
  | Readonly<{ disposition: 'duplicate' }>;

export type OfxTransactionBatchOutcome =
  | OfxTransactionImportResult
  | Readonly<{
      disposition: 'failed';
      errorCode: 'account_not_found' | 'account_archived' | 'invalid_request';
    }>;

export interface OfxTransactionImporter {
  /** Importa um lote da mesma conta; a resposta segue a ordem da entrada. */
  importMany(
    context: TenantContext,
    inputs: readonly OfxTransactionImportInput[],
  ): Promise<OfxTransactionBatchOutcome[]>;
}
