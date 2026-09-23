import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { format } from 'prettier';
import { HealthController } from '../src/health/health.controller.js';
import { DatabaseSecurityCheckService } from '../src/infrastructure/database/database-security-check.service.js';
import { AccountsController } from '../src/modules/accounts/adapters/inbound/accounts.controller.js';
import { CreateManualAccount } from '../src/modules/accounts/application/use-cases/create-manual-account.js';
import { ListAccounts } from '../src/modules/accounts/application/use-cases/list-accounts.js';
import { DeactivateAccount } from '../src/modules/accounts/application/use-cases/deactivate-account.js';
import { UpdateAccount } from '../src/modules/accounts/application/use-cases/update-account.js';
import { TransactionsController } from '../src/modules/transactions/adapters/inbound/transactions.controller.js';
import { TRANSACTIONS_OPENAPI_SCHEMAS } from '../src/modules/transactions/adapters/inbound/transactions-openapi.schema.js';
import { CreateAccountingTransfer } from '../src/modules/transactions/application/use-cases/create-accounting-transfer.js';
import { CreateCategory } from '../src/modules/transactions/application/use-cases/create-category.js';
import { CreateCategoryRule } from '../src/modules/transactions/application/use-cases/create-category-rule.js';
import { CreateManualTransaction } from '../src/modules/transactions/application/use-cases/create-manual-transaction.js';
import { DeactivateCategory } from '../src/modules/transactions/application/use-cases/deactivate-category.js';
import { CategoryRuleLifecycle } from '../src/modules/transactions/application/use-cases/category-rule-lifecycle.js';
import { ListCategories } from '../src/modules/transactions/application/use-cases/list-categories.js';
import { ListCategoryRules } from '../src/modules/transactions/application/use-cases/list-category-rules.js';
import { ListTransactions } from '../src/modules/transactions/application/use-cases/list-transactions.js';
import { UpdateCategory } from '../src/modules/transactions/application/use-cases/update-category.js';
import { UpdateCategoryRule } from '../src/modules/transactions/application/use-cases/update-category-rule.js';
import { UpdateTransactionCategory } from '../src/modules/transactions/application/use-cases/update-transaction-category.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../src/modules/identity/adapters/inbound/auth0-access-token-verifier.js';
import { ResolveIdentityContext } from '../src/modules/identity/application/resolve-identity-context.js';

const databaseSecurityCheck: Pick<
  DatabaseSecurityCheckService,
  'assertRuntimeRoleIsSafe'
> = {
  async assertRuntimeRoleIsSafe(): Promise<void> {},
};

const createManualAccount: Pick<CreateManualAccount, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const listAccounts: Pick<ListAccounts, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const updateAccount: Pick<UpdateAccount, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const deactivateAccount: Pick<DeactivateAccount, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const createManualTransaction: Pick<CreateManualTransaction, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const createAccountingTransfer: Pick<CreateAccountingTransfer, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const listTransactions: Pick<ListTransactions, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const updateTransactionCategory: Pick<
  UpdateTransactionCategory,
  'execute'
> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const listCategories: Pick<ListCategories, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const createCategory: Pick<CreateCategory, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const updateCategory: Pick<UpdateCategory, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const deactivateCategory: Pick<DeactivateCategory, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const listCategoryRules: Pick<ListCategoryRules, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const createCategoryRule: Pick<CreateCategoryRule, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const updateCategoryRule: Pick<UpdateCategoryRule, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const categoryRuleLifecycle: Pick<CategoryRuleLifecycle, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not execute use cases.')),
};

const accessTokenVerifier: AccessTokenVerifier = {
  verify: () =>
    Promise.reject(new Error('OpenAPI generation does not verify tokens.')),
};

const resolveIdentityContext: Pick<ResolveIdentityContext, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not resolve identity.')),
};

@Module({
  controllers: [HealthController, AccountsController, TransactionsController],
  providers: [
    {
      provide: DatabaseSecurityCheckService,
      useValue: databaseSecurityCheck,
    },
    { provide: CreateManualAccount, useValue: createManualAccount },
    { provide: ListAccounts, useValue: listAccounts },
    { provide: UpdateAccount, useValue: updateAccount },
    { provide: DeactivateAccount, useValue: deactivateAccount },
    { provide: CreateManualTransaction, useValue: createManualTransaction },
    { provide: CreateAccountingTransfer, useValue: createAccountingTransfer },
    { provide: ListTransactions, useValue: listTransactions },
    { provide: UpdateTransactionCategory, useValue: updateTransactionCategory },
    { provide: ListCategories, useValue: listCategories },
    { provide: CreateCategory, useValue: createCategory },
    { provide: UpdateCategory, useValue: updateCategory },
    { provide: DeactivateCategory, useValue: deactivateCategory },
    { provide: ListCategoryRules, useValue: listCategoryRules },
    { provide: CreateCategoryRule, useValue: createCategoryRule },
    { provide: UpdateCategoryRule, useValue: updateCategoryRule },
    { provide: CategoryRuleLifecycle, useValue: categoryRuleLifecycle },
    { provide: ACCESS_TOKEN_VERIFIER, useValue: accessTokenVerifier },
    { provide: ResolveIdentityContext, useValue: resolveIdentityContext },
  ],
})
class OpenApiModule {}

const app = await NestFactory.create(OpenApiModule, {
  logger: false,
  abortOnError: false,
});
await app.init();
app.setGlobalPrefix('api/v1');
const config = new DocumentBuilder()
  .setTitle('Centralizador Financeiro API')
  .setDescription(
    'Authenticated accounts API for the academic financial-management MVP.',
  )
  .setVersion('1.0')
  .addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    'auth0',
  )
  .build();
const document = SwaggerModule.createDocument(app, config);
document.components = {
  ...(document.components ?? {}),
  schemas: {
    ...(document.components?.schemas ?? {}),
    ...TRANSACTIONS_OPENAPI_SCHEMAS,
  },
};
const serializedDocument = await format(JSON.stringify(document), {
  parser: 'json',
});
await mkdir('openapi', { recursive: true });
await writeFile('openapi/openapi.json', serializedDocument, 'utf8');
await app.close();
