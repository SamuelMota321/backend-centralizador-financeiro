import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.schema.js';
import { HealthModule } from './health/health.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';

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
    HealthModule,
  ],
})
export class AppModule {}
