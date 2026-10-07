import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AccountOwnership } from '../../../accounts/application/ports/account-ownership.port.js';
import type { OfxAccountOwnership } from '../../application/ports/ofx-account-ownership.port.js';

@Injectable()
export class AccountsOfxAccountOwnershipAdapter implements OfxAccountOwnership {
  constructor(private readonly accountOwnership: AccountOwnership) {}

  getOwnedState(context: TenantContext, accountId: string) {
    return this.accountOwnership.getOwnedImportAvailability(context, accountId);
  }
}
