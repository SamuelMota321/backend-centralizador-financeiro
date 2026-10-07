import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export const OFX_ACCOUNT_OWNERSHIP = Symbol('OFX_ACCOUNT_OWNERSHIP');

export type OfxAccountOwnershipState =
  | 'active_local'
  | 'active_connected'
  | 'archived_local'
  | 'archived_connected'
  | 'missing';

export interface OfxAccountOwnership {
  getOwnedState(
    context: TenantContext,
    accountId: string,
  ): Promise<OfxAccountOwnershipState>;
}
