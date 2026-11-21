import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { QStashPluggyWebhookService } from '../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import { PluggyConnectionLifecycle } from '../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import {
  CONNECTIONS_COLLECTION_ELIGIBILITY,
  type ConnectionsCollectionEligibility,
} from '../accounts/application/ports/connections.repository.port.js';
import {
  PLUGGY_PROVIDER,
  type PluggyProvider,
} from '../accounts/application/ports/pluggy-provider.port.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { ImportPluggyTransaction } from '../transactions/application/use-cases/import-pluggy-transaction.js';
import {
  PluggySyncController,
  PluggySyncWorkerController,
} from './adapters/inbound/pluggy-sync.controller.js';
import { PrismaPluggySyncRepository } from './adapters/outbound/prisma-pluggy-sync.repository.js';
import {
  PLUGGY_SYNC_REPOSITORY,
  type PluggySyncRepository,
} from './application/ports/pluggy-sync.repository.port.js';
import { PluggySynchronization } from './application/pluggy-synchronization.js';

@Module({
  imports: [AccountsModule, TransactionsModule, IdentityModule],
  controllers: [PluggySyncController, PluggySyncWorkerController],
  providers: [
    PrismaPluggySyncRepository,
    {
      provide: PLUGGY_SYNC_REPOSITORY,
      useExisting: PrismaPluggySyncRepository,
    },
    {
      provide: PluggySynchronization,
      useFactory: (
        repository: PluggySyncRepository,
        lifecycle: PluggyConnectionLifecycle,
        eligibility: ConnectionsCollectionEligibility,
        provider: PluggyProvider,
        importTransaction: ImportPluggyTransaction,
        queue: QStashPluggyWebhookService,
      ) =>
        new PluggySynchronization(
          repository,
          lifecycle,
          eligibility,
          provider,
          importTransaction,
          queue,
        ),
      inject: [
        PLUGGY_SYNC_REPOSITORY,
        PluggyConnectionLifecycle,
        CONNECTIONS_COLLECTION_ELIGIBILITY,
        PLUGGY_PROVIDER,
        ImportPluggyTransaction,
        QStashPluggyWebhookService,
      ],
    },
  ],
})
export class SyncModule {}
