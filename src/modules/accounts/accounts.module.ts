import { Module } from '@nestjs/common';
import { PrismaTenantUnitOfWork } from '../../infrastructure/database/prisma-tenant-unit-of-work.js';
import {
  TENANT_UNIT_OF_WORK,
  type TenantUnitOfWork,
} from '../../shared/application/ports/tenant-unit-of-work.port.js';
import { AuditModule } from '../audit/audit.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AccountsController } from './adapters/inbound/accounts.controller.js';
import {
  PluggyConnectionsController,
  PluggyEventWorkerController,
  PluggyWebhookController,
} from './adapters/inbound/pluggy-connections.controller.js';
import { PluggyApiClient } from './adapters/outbound/pluggy-api.client.js';
import { QStashPluggyWebhookService } from './adapters/outbound/qstash-pluggy-webhook.service.js';
import { PrismaAccountOwnership } from './adapters/outbound/prisma-account-ownership.repository.js';
import { PrismaAccountsRepository } from './adapters/outbound/prisma-accounts.repository.js';
import { ACCOUNT_OWNERSHIP } from './application/ports/account-ownership.port.js';
import {
  ACCOUNTS_REPOSITORY,
  type AccountMaintenanceScope,
  type AccountsRepository,
} from './application/ports/accounts.repository.port.js';
import { CreateManualAccount } from './application/use-cases/create-manual-account.js';
import { DeactivateAccount } from './application/use-cases/deactivate-account.js';
import { ListAccounts } from './application/use-cases/list-accounts.js';
import { UpdateAccount } from './application/use-cases/update-account.js';
import {
  AccountsConnectionCollectionEligibility,
  PluggyConnectionLifecycle,
} from './application/use-cases/pluggy-connection-lifecycle.js';
import {
  CONNECTIONS_COLLECTION_ELIGIBILITY,
  type ConnectionsCollectionEligibility,
} from './application/ports/connections.repository.port.js';
import {
  PLUGGY_PROVIDER,
  type PluggyProvider,
} from './application/ports/pluggy-provider.port.js';

@Module({
  imports: [IdentityModule, AuditModule],
  controllers: [
    AccountsController,
    PluggyConnectionsController,
    PluggyWebhookController,
    PluggyEventWorkerController,
  ],
  providers: [
    PluggyApiClient,
    QStashPluggyWebhookService,
    {
      provide: PLUGGY_PROVIDER,
      useExisting: PluggyApiClient,
    },
    PrismaAccountsRepository,
    PrismaAccountOwnership,
    {
      provide: TENANT_UNIT_OF_WORK,
      useExisting: PrismaTenantUnitOfWork,
    },
    {
      provide: ACCOUNTS_REPOSITORY,
      useExisting: PrismaAccountsRepository,
    },
    {
      provide: ACCOUNT_OWNERSHIP,
      useExisting: PrismaAccountOwnership,
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
    {
      provide: PluggyConnectionLifecycle,
      useFactory: (
        unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
        provider: PluggyProvider,
      ) => new PluggyConnectionLifecycle(unitOfWork, provider),
      inject: [TENANT_UNIT_OF_WORK, PLUGGY_PROVIDER],
    },
    {
      provide: CONNECTIONS_COLLECTION_ELIGIBILITY,
      useFactory: (
        unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
        provider: PluggyProvider,
      ): ConnectionsCollectionEligibility =>
        new AccountsConnectionCollectionEligibility(unitOfWork, provider),
      inject: [TENANT_UNIT_OF_WORK, PLUGGY_PROVIDER],
    },
  ],
  exports: [ACCOUNT_OWNERSHIP, CONNECTIONS_COLLECTION_ELIGIBILITY],
})
export class AccountsModule {}
