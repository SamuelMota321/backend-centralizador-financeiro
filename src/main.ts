import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.schema.js';
import { jsonParserProblemDetailsMiddleware } from './shared/adapters/inbound/json-parser-problem-details.middleware.js';
import { RequestIdMiddleware } from './shared/adapters/inbound/request-id.middleware.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: true }),
    bodyParser: false,
  });
  app.useBodyParser('json');
  app.use(new RequestIdMiddleware().use);
  app.use(jsonParserProblemDetailsMiddleware);
  const config = app.get(ConfigService<Environment, true>);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
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
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
