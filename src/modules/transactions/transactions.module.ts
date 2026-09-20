import { Module } from '@nestjs/common';
import { PrismaTransactionsRepository } from './adapters/outbound/prisma-transactions.repository.js';
import { CreateCategory } from './application/use-cases/create-category.js';
import { CreateCategoryRule } from './application/use-cases/create-category-rule.js';
import { GetTransaction } from './application/use-cases/get-transaction.js';
import {
  TRANSACTIONS_REPOSITORY,
  type TransactionsRepository,
} from './application/ports/transactions.repository.port.js';
import { TRANSACTIONS_UNIT_OF_WORK } from './application/ports/transactions.unit-of-work.port.js';

@Module({
  providers: [
    PrismaTransactionsRepository,
    {
      provide: TRANSACTIONS_REPOSITORY,
      useExisting: PrismaTransactionsRepository,
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
  ],
})
export class TransactionsModule {}
