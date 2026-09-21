import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import {
  ACCOUNT_OWNERSHIP,
  type AccountOwnership,
} from '../accounts/application/ports/account-ownership.port.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TransactionsController } from './adapters/inbound/transactions.controller.js';
import { PrismaTransactionsRepository } from './adapters/outbound/prisma-transactions.repository.js';
import {
  TRANSACTION_ACCOUNT_STATE,
  type TransactionAccountStateReader,
} from './application/ports/transaction-account-state.port.js';
import { CreateCategory } from './application/use-cases/create-category.js';
import { CreateCategoryRule } from './application/use-cases/create-category-rule.js';
import { CreateAccountingTransfer } from './application/use-cases/create-accounting-transfer.js';
import { CreateManualTransaction } from './application/use-cases/create-manual-transaction.js';
import { GetTransaction } from './application/use-cases/get-transaction.js';
import {
  TRANSACTIONS_REPOSITORY,
  type TransactionsRepository,
} from './application/ports/transactions.repository.port.js';
import {
  TRANSACTIONS_UNIT_OF_WORK,
  type TransactionsUnitOfWork,
} from './application/ports/transactions.unit-of-work.port.js';

@Module({
  imports: [AccountsModule, IdentityModule],
  controllers: [TransactionsController],
  providers: [
    PrismaTransactionsRepository,
    {
      provide: TRANSACTIONS_REPOSITORY,
      useExisting: PrismaTransactionsRepository,
    },
    {
      provide: TRANSACTION_ACCOUNT_STATE,
      useFactory: (
        ownership: AccountOwnership,
      ): TransactionAccountStateReader => ownership,
      inject: [ACCOUNT_OWNERSHIP],
    },
    {
      provide: CreateManualTransaction,
      useFactory: (
        repository: TransactionsRepository,
        unitOfWork: TransactionsUnitOfWork,
        accountState: TransactionAccountStateReader,
      ) => new CreateManualTransaction(repository, unitOfWork, accountState),
      inject: [
        TRANSACTIONS_REPOSITORY,
        TRANSACTIONS_UNIT_OF_WORK,
        TRANSACTION_ACCOUNT_STATE,
      ],
    },
    {
      provide: CreateAccountingTransfer,
      useFactory: (
        repository: TransactionsRepository,
        unitOfWork: TransactionsUnitOfWork,
        accountState: TransactionAccountStateReader,
      ) => new CreateAccountingTransfer(repository, unitOfWork, accountState),
      inject: [
        TRANSACTIONS_REPOSITORY,
        TRANSACTIONS_UNIT_OF_WORK,
        TRANSACTION_ACCOUNT_STATE,
      ],
    },
    {
      provide: TRANSACTIONS_UNIT_OF_WORK,
      useExisting: PrismaTransactionsRepository,
    },
    {
      provide: CreateCategory,
      useFactory: (repository: TransactionsRepository) =>
        new CreateCategory(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: CreateCategoryRule,
      useFactory: (repository: TransactionsRepository) =>
        new CreateCategoryRule(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: GetTransaction,
      useFactory: (repository: TransactionsRepository) =>
        new GetTransaction(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
  ],
  exports: [
    PrismaTransactionsRepository,
    TRANSACTIONS_REPOSITORY,
    TRANSACTIONS_UNIT_OF_WORK,
    CreateCategory,
    CreateCategoryRule,
    GetTransaction,
    CreateManualTransaction,
    CreateAccountingTransfer,
  ],
})
export class TransactionsModule {}
