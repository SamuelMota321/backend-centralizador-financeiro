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

const accessTokenVerifier: AccessTokenVerifier = {
  verify: () =>
    Promise.reject(new Error('OpenAPI generation does not verify tokens.')),
};

const resolveIdentityContext: Pick<ResolveIdentityContext, 'execute'> = {
  execute: () =>
    Promise.reject(new Error('OpenAPI generation does not resolve identity.')),
};

@Module({
  controllers: [HealthController, AccountsController],
  providers: [
    {
      provide: DatabaseSecurityCheckService,
      useValue: databaseSecurityCheck,
    },
    { provide: CreateManualAccount, useValue: createManualAccount },
    { provide: ListAccounts, useValue: listAccounts },
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
const serializedDocument = await format(JSON.stringify(document), {
  parser: 'json',
});
await mkdir('openapi', { recursive: true });
await writeFile('openapi/openapi.json', serializedDocument, 'utf8');
await app.close();
