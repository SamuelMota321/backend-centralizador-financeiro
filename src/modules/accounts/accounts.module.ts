import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { AccountsController } from './adapters/inbound/accounts.controller.js';
import { PrismaAccountsRepository } from './adapters/outbound/prisma-accounts.repository.js';
import {
  ACCOUNTS_REPOSITORY,
  type AccountsRepository,
} from './application/ports/accounts.repository.port.js';
import { CreateManualAccount } from './application/use-cases/create-manual-account.js';
import { ListAccounts } from './application/use-cases/list-accounts.js';

@Module({
  imports: [IdentityModule],
  controllers: [AccountsController],
  providers: [
    PrismaAccountsRepository,
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
  ],
})
export class AccountsModule {}
