import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const ACCOUNT_OWNERSHIP = Symbol('ACCOUNT_OWNERSHIP');

export type AccountOwnershipState = 'active' | 'archived' | 'missing';

export interface AccountOwnership {
  getOwnedState(
    context: TenantContext,
    accountId: string,
  ): Promise<AccountOwnershipState>;
}
