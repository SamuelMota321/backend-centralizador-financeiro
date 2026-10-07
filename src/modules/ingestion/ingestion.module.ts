import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import {
  ACCOUNT_OWNERSHIP,
  type AccountOwnership,
} from '../accounts/application/ports/account-ownership.port.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { ImportOfxTransaction } from '../transactions/application/use-cases/import-ofx-transaction.js';
import { AccountsOfxAccountOwnershipAdapter } from './adapters/outbound/accounts-ofx-account-ownership.adapter.js';
import { OfxJsParserAdapter } from './adapters/outbound/ofx-js-parser.adapter.js';
import { PrismaIngestionRepository } from './adapters/outbound/prisma-ingestion.repository.js';
import { TransactionsOfxImporterAdapter } from './adapters/outbound/transactions-ofx-importer.adapter.js';
import {
  INGESTION_REPOSITORY,
  type IngestionRepository,
} from './application/ports/ingestion.repository.port.js';
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
import { TransitionImportRun } from './application/use-cases/transition-import-run.js';

@Module({
  imports: [AccountsModule, TransactionsModule],
  providers: [
    OfxJsParserAdapter,
    PrismaIngestionRepository,
    { provide: OFX_PARSER, useExisting: OfxJsParserAdapter },
    { provide: INGESTION_REPOSITORY, useExisting: PrismaIngestionRepository },
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
      useFactory: (parser: OfxParser, repository: IngestionRepository) =>
        new CreateOfxImportPreview(parser, repository),
      inject: [OFX_PARSER, INGESTION_REPOSITORY],
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
    OFX_ACCOUNT_OWNERSHIP,
    OFX_TRANSACTION_IMPORTER,
    CreateOfxImportPreview,
    TransitionImportRun,
  ],
})
export class IngestionModule {}
