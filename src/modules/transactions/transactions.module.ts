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
import { DeactivateCategory } from './application/use-cases/deactivate-category.js';
import { CategoryRuleLifecycle } from './application/use-cases/category-rule-lifecycle.js';
import { GetTransaction } from './application/use-cases/get-transaction.js';
import { ListCategories } from './application/use-cases/list-categories.js';
import { ListCategoryRules } from './application/use-cases/list-category-rules.js';
import { ListTransactions } from './application/use-cases/list-transactions.js';
import { UpdateCategory } from './application/use-cases/update-category.js';
import { UpdateCategoryRule } from './application/use-cases/update-category-rule.js';
import { UpdateTransactionCategory } from './application/use-cases/update-transaction-category.js';
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
      useFactory: (
        repository: TransactionsRepository,
        accountState: TransactionAccountStateReader,
      ) => new CreateCategoryRule(repository, accountState),
      inject: [TRANSACTIONS_REPOSITORY, TRANSACTION_ACCOUNT_STATE],
    },
    {
      provide: ListTransactions,
      useFactory: (repository: TransactionsRepository) =>
        new ListTransactions(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: UpdateTransactionCategory,
      useFactory: (repository: TransactionsRepository) =>
        new UpdateTransactionCategory(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: ListCategories,
      useFactory: (repository: TransactionsRepository) =>
        new ListCategories(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: UpdateCategory,
      useFactory: (unitOfWork: TransactionsUnitOfWork) =>
        new UpdateCategory(unitOfWork),
      inject: [TRANSACTIONS_UNIT_OF_WORK],
    },
    {
      provide: DeactivateCategory,
      useFactory: (unitOfWork: TransactionsUnitOfWork) =>
        new DeactivateCategory(unitOfWork),
      inject: [TRANSACTIONS_UNIT_OF_WORK],
    },
    {
      provide: ListCategoryRules,
      useFactory: (repository: TransactionsRepository) =>
        new ListCategoryRules(repository),
      inject: [TRANSACTIONS_REPOSITORY],
    },
    {
      provide: UpdateCategoryRule,
      useFactory: (
        repository: TransactionsRepository,
        unitOfWork: TransactionsUnitOfWork,
        accountState: TransactionAccountStateReader,
      ) => new UpdateCategoryRule(repository, unitOfWork, accountState),
      inject: [
        TRANSACTIONS_REPOSITORY,
        TRANSACTIONS_UNIT_OF_WORK,
        TRANSACTION_ACCOUNT_STATE,
      ],
    },
    {
      provide: CategoryRuleLifecycle,
      useFactory: (unitOfWork: TransactionsUnitOfWork) =>
        new CategoryRuleLifecycle(unitOfWork),
      inject: [TRANSACTIONS_UNIT_OF_WORK],
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
    ListTransactions,
    UpdateTransactionCategory,
    ListCategories,
    UpdateCategory,
    DeactivateCategory,
    ListCategoryRules,
    UpdateCategoryRule,
    CategoryRuleLifecycle,
  ],
})
export class TransactionsModule {}
