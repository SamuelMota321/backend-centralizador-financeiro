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

export interface OfxTransactionImporter {
  import(
    context: TenantContext,
    input: OfxTransactionImportInput,
  ): Promise<OfxTransactionImportResult>;
}
