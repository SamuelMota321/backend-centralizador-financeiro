import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ json: true }),
  });
  const config = app.get(ConfigService<Environment, true>);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
    .setTitle('Centralizador Financeiro API')
    .setDescription(
      'Backend REST foundation for the academic financial-management MVP.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/v1/docs', app, document, {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
