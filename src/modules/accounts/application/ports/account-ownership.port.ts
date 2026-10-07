import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const ACCOUNT_OWNERSHIP = Symbol('ACCOUNT_OWNERSHIP');

export type AccountOwnershipState = 'active' | 'archived' | 'missing';
export type AccountImportAvailability =
  | 'active_local'
  | 'active_connected'
  | 'archived_local'
  | 'archived_connected'
  | 'missing';

export interface AccountOwnership {
  getOwnedState(
    context: TenantContext,
    accountId: string,
  ): Promise<AccountOwnershipState>;
  getOwnedImportAvailability(
    context: TenantContext,
    accountId: string,
  ): Promise<AccountImportAvailability>;
}
