import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import {
  ACCOUNT_OWNERSHIP,
  type AccountOwnership,
} from '../accounts/application/ports/account-ownership.port.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { FindOfxTransactionDuplicates } from '../transactions/application/use-cases/find-ofx-transaction-duplicates.js';
import { ImportOfxTransaction } from '../transactions/application/use-cases/import-ofx-transaction.js';
import { ImportPluggyTransaction } from '../transactions/application/use-cases/import-pluggy-transaction.js';
import {
  CreatePluggyConnectedAccount,
  AssociatePluggyAccount,
} from '../accounts/application/use-cases/pluggy-account-mapping.js';
import { PluggyConnectionLifecycle } from '../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import {
  PLUGGY_PROVIDER,
  type PluggyProvider,
} from '../accounts/application/ports/pluggy-provider.port.js';
import {
  CONNECTIONS_COLLECTION_ELIGIBILITY,
  type ConnectionsCollectionEligibility,
} from '../accounts/application/ports/connections.repository.port.js';
import { QStashPluggyWebhookService } from '../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import { AccountsOfxAccountOwnershipAdapter } from './adapters/outbound/accounts-ofx-account-ownership.adapter.js';
import { CloudflareR2OfxSourceObjectStore } from './adapters/outbound/cloudflare-r2-ofx-source-object-store.adapter.js';
import { OfxJsParserAdapter } from './adapters/outbound/ofx-js-parser.adapter.js';
import { PrismaIngestionRepository } from './adapters/outbound/prisma-ingestion.repository.js';
import { PrismaPluggyInitialImportRepository } from './adapters/outbound/prisma-pluggy-initial-import.repository.js';
import { TransactionsOfxImporterAdapter } from './adapters/outbound/transactions-ofx-importer.adapter.js';
import { IngestionController } from './adapters/inbound/ingestion.controller.js';
import {
  PluggyInitialImportController,
  PluggyInitialImportWorkerController,
} from './adapters/inbound/pluggy-initial-import.controller.js';
import {
  INGESTION_REPOSITORY,
  type IngestionRepository,
} from './application/ports/ingestion.repository.port.js';
import {
  PLUGGY_INITIAL_IMPORT_REPOSITORY,
  type PluggyInitialImportRepository,
} from './application/ports/pluggy-initial-import.repository.port.js';
import {
  OFX_ACCOUNT_OWNERSHIP,
  type OfxAccountOwnership,
} from './application/ports/ofx-account-ownership.port.js';
import {
  OFX_PARSER,
  type OfxParser,
} from './application/ports/ofx-parser.port.js';
import {
  OFX_TRANSACTION_IMPORTER,
  type OfxTransactionImporter,
} from './application/ports/ofx-transaction-importer.port.js';
import { CreateOfxImportPreview } from './application/use-cases/create-ofx-import-preview.js';
import { ConfirmOfxImport } from './application/use-cases/confirm-ofx-import.js';
import { GetImportRun } from './application/use-cases/get-import-run.js';
import { TransitionImportRun } from './application/use-cases/transition-import-run.js';
import { PluggyInitialImport } from './application/use-cases/pluggy-initial-import.js';
import {
  OFX_SOURCE_OBJECT_STORE,
  type OfxSourceObjectStore,
} from './application/ports/ofx-source-object-store.port.js';

@Module({
  imports: [AccountsModule, IdentityModule, TransactionsModule],
  controllers: [
    IngestionController,
    PluggyInitialImportController,
    PluggyInitialImportWorkerController,
  ],
  providers: [
    OfxJsParserAdapter,
    CloudflareR2OfxSourceObjectStore,
    PrismaIngestionRepository,
    PrismaPluggyInitialImportRepository,
    {
      provide: PLUGGY_INITIAL_IMPORT_REPOSITORY,
      useExisting: PrismaPluggyInitialImportRepository,
    },
    { provide: OFX_PARSER, useExisting: OfxJsParserAdapter },
    { provide: INGESTION_REPOSITORY, useExisting: PrismaIngestionRepository },
    {
      provide: OFX_SOURCE_OBJECT_STORE,
      useExisting: CloudflareR2OfxSourceObjectStore,
    },
    {
      provide: PluggyInitialImport,
      useFactory: (
        repository: PluggyInitialImportRepository,
        lifecycle: PluggyConnectionLifecycle,
        eligibility: ConnectionsCollectionEligibility,
        provider: PluggyProvider,
        createConnectedAccount: CreatePluggyConnectedAccount,
        associateAccount: AssociatePluggyAccount,
        importTransaction: ImportPluggyTransaction,
        queue: QStashPluggyWebhookService,
      ) =>
        new PluggyInitialImport(
          repository,
          lifecycle,
          eligibility,
          provider,
          createConnectedAccount,
          associateAccount,
          importTransaction,
          queue,
        ),
      inject: [
        PLUGGY_INITIAL_IMPORT_REPOSITORY,
        PluggyConnectionLifecycle,
        CONNECTIONS_COLLECTION_ELIGIBILITY,
        PLUGGY_PROVIDER,
        CreatePluggyConnectedAccount,
        AssociatePluggyAccount,
        ImportPluggyTransaction,
        QStashPluggyWebhookService,
      ],
    },
    {
      provide: OFX_ACCOUNT_OWNERSHIP,
      useFactory: (ownership: AccountOwnership): OfxAccountOwnership =>
        new AccountsOfxAccountOwnershipAdapter(ownership),
      inject: [ACCOUNT_OWNERSHIP],
    },
    {
      provide: OFX_TRANSACTION_IMPORTER,
      useFactory: (importer: ImportOfxTransaction): OfxTransactionImporter =>
        new TransactionsOfxImporterAdapter(importer),
      inject: [ImportOfxTransaction],
    },
    {
      provide: CreateOfxImportPreview,
      useFactory: (
        parser: OfxParser,
        repository: IngestionRepository,
        accountOwnership: OfxAccountOwnership,
        findDuplicates: FindOfxTransactionDuplicates,
        sourceObjectStore: OfxSourceObjectStore,
      ) =>
        new CreateOfxImportPreview(
          parser,
          repository,
          accountOwnership,
          findDuplicates,
          sourceObjectStore,
        ),
      inject: [
        OFX_PARSER,
        INGESTION_REPOSITORY,
        OFX_ACCOUNT_OWNERSHIP,
        FindOfxTransactionDuplicates,
        OFX_SOURCE_OBJECT_STORE,
      ],
    },
    {
      provide: ConfirmOfxImport,
      useFactory: (
        repository: IngestionRepository,
        importer: OfxTransactionImporter,
        sourceObjectStore: OfxSourceObjectStore,
      ) => new ConfirmOfxImport(repository, importer, sourceObjectStore),
      inject: [
        INGESTION_REPOSITORY,
        OFX_TRANSACTION_IMPORTER,
        OFX_SOURCE_OBJECT_STORE,
      ],
    },
    {
      provide: GetImportRun,
      useFactory: (repository: IngestionRepository) =>
        new GetImportRun(repository),
      inject: [INGESTION_REPOSITORY],
    },
    {
      provide: TransitionImportRun,
      useFactory: (repository: IngestionRepository) =>
        new TransitionImportRun(repository),
      inject: [INGESTION_REPOSITORY],
    },
  ],
  exports: [
    INGESTION_REPOSITORY,
    PLUGGY_INITIAL_IMPORT_REPOSITORY,
    OFX_ACCOUNT_OWNERSHIP,
    OFX_TRANSACTION_IMPORTER,
    CreateOfxImportPreview,
    ConfirmOfxImport,
    GetImportRun,
    TransitionImportRun,
  ],
})
export class IngestionModule {}
