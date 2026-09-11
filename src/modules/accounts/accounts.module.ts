import { Module } from '@nestjs/common';
import { PrismaTenantUnitOfWork } from '../../infrastructure/database/prisma-tenant-unit-of-work.js';
import {
  TENANT_UNIT_OF_WORK,
  type TenantUnitOfWork,
} from '../../shared/application/ports/tenant-unit-of-work.port.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AccountsController } from './adapters/inbound/accounts.controller.js';
import { PrismaAccountsRepository } from './adapters/outbound/prisma-accounts.repository.js';
import {
  ACCOUNTS_REPOSITORY,
  type AccountMaintenanceScope,
  type AccountsRepository,
} from './application/ports/accounts.repository.port.js';
import { CreateManualAccount } from './application/use-cases/create-manual-account.js';
import { DeactivateAccount } from './application/use-cases/deactivate-account.js';
import { ListAccounts } from './application/use-cases/list-accounts.js';
import { UpdateAccount } from './application/use-cases/update-account.js';

@Module({
  imports: [IdentityModule, AuditModule],
  controllers: [AccountsController],
  providers: [
    PrismaAccountsRepository,
    {
      provide: TENANT_UNIT_OF_WORK,
      useExisting: PrismaTenantUnitOfWork,
    },
    {
      provide: ACCOUNTS_REPOSITORY,
      useExisting: PrismaAccountsRepository,
    },
    {
      provide: CreateManualAccount,
      useFactory: (repository: AccountsRepository) =>
        new CreateManualAccount(repository),
      inject: [ACCOUNTS_REPOSITORY],
    },
    {
      provide: ListAccounts,
      useFactory: (repository: AccountsRepository) =>
        new ListAccounts(repository),
      inject: [ACCOUNTS_REPOSITORY],
    },
    {
      provide: UpdateAccount,
      useFactory: (unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>) =>
        new UpdateAccount(unitOfWork),
      inject: [TENANT_UNIT_OF_WORK],
    },
    {
      provide: DeactivateAccount,
      useFactory: (unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>) =>
        new DeactivateAccount(unitOfWork),
      inject: [TENANT_UNIT_OF_WORK],
    },
  ],
})
export class AccountsModule {}
