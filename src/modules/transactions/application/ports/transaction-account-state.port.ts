import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const TRANSACTION_ACCOUNT_STATE = Symbol('TRANSACTION_ACCOUNT_STATE');

export type TransactionAccountState = 'active' | 'archived' | 'missing';

export interface TransactionAccountStateReader {
  getOwnedState(
    context: TenantContext,
    accountId: string,
  ): Promise<TransactionAccountState>;
}
