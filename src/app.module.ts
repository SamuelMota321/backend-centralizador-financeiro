import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.schema.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { PatrimonyModule } from './modules/patrimony/patrimony.module.js';
import { InvestmentsModule } from './modules/investments/investments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    IdentityModule,
    AccountsModule,
    TransactionsModule,
    IngestionModule,
    SyncModule,
    PatrimonyModule,
    InvestmentsModule,
    HealthModule,
  ],
})
export class AppModule {}
