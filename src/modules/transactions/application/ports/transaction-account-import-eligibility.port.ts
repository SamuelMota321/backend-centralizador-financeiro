import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const TRANSACTION_ACCOUNT_IMPORT_ELIGIBILITY = Symbol(
  'TRANSACTION_ACCOUNT_IMPORT_ELIGIBILITY',
);

export type TransactionAccountImportAvailability =
  | 'active_local'
  | 'active_connected'
  | 'archived_local'
  | 'archived_connected'
  | 'missing';

export interface TransactionAccountImportEligibilityReader {
  getOwnedImportAvailability(
    context: TenantContext,
    accountId: string,
  ): Promise<TransactionAccountImportAvailability>;
}
