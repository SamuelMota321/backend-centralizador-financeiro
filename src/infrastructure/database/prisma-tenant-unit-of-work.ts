import { Injectable } from '@nestjs/common';
import type { TenantUnitOfWork } from '../../shared/application/ports/tenant-unit-of-work.port.js';
import type { AccountMaintenanceScope } from '../../modules/accounts/application/ports/accounts.repository.port.js';
import { PrismaAuditWriter } from '../../modules/audit/adapters/outbound/prisma-audit-writer.js';
import { PrismaTenantAccountsRepository } from '../../modules/accounts/adapters/outbound/prisma-accounts.repository.js';
import type { TenantContext } from '../../shared/application/tenant-context.js';
import { PrismaTenantTransaction } from './prisma-tenant-transaction.js';

@Injectable()
export class PrismaTenantUnitOfWork implements TenantUnitOfWork<AccountMaintenanceScope> {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  run<Result>(
    context: TenantContext,
    operation: (scope: AccountMaintenanceScope) => Promise<Result>,
  ): Promise<Result> {
    return this.tenantTransaction.run(context, async (transaction) =>
      operation({
        accounts: new PrismaTenantAccountsRepository(transaction, context),
        audit: new PrismaAuditWriter(transaction),
      }),
    );
  }
}
