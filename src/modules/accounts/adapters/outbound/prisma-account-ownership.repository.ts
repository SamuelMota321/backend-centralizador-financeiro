import { Injectable } from '@nestjs/common';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  AccountOwnership,
  AccountOwnershipState,
} from '../../application/ports/account-ownership.port.js';

@Injectable()
export class PrismaAccountOwnership implements AccountOwnership {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  getOwnedState(
    context: TenantContext,
    accountId: string,
  ): Promise<AccountOwnershipState> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const account = await transaction.account.findFirst({
        where: { id: accountId, tenantId: context.tenantId },
        select: { archivedAt: true },
      });

      if (!account) return 'missing';
      return account.archivedAt === null ? 'active' : 'archived';
    });
  }
}
