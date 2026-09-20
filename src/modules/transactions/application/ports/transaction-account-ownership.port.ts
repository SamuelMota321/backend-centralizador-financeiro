import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const TRANSACTION_ACCOUNT_OWNERSHIP = Symbol(
  'TRANSACTION_ACCOUNT_OWNERSHIP',
);

export interface TransactionAccountOwnership {
  isActiveOwned(context: TenantContext, accountId: string): Promise<boolean>;
}
