import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { format } from 'prettier';
import { HealthController } from '../src/health/health.controller.js';
import { DatabaseSecurityCheckService } from '../src/infrastructure/database/database-security-check.service.js';

const databaseSecurityCheck: Pick<
  DatabaseSecurityCheckService,
  'assertRuntimeRoleIsSafe'
> = {
  async assertRuntimeRoleIsSafe(): Promise<void> {},
};

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DatabaseSecurityCheckService,
      useValue: databaseSecurityCheck,
    },
  ],
})
class OpenApiModule {}

const app = await NestFactory.create(OpenApiModule, { logger: false });
await app.init();
app.setGlobalPrefix('api/v1');
const config = new DocumentBuilder()
  .setTitle('Centralizador Financeiro API')
  .setDescription(
    'Backend REST foundation for the academic financial-management MVP.',
  )
  .setVersion('1.0')
  .build();
const document = SwaggerModule.createDocument(app, config);
const serializedDocument = await format(JSON.stringify(document), {
  parser: 'json',
});
await mkdir('openapi', { recursive: true });
await writeFile('openapi/openapi.json', serializedDocument, 'utf8');
await app.close();
