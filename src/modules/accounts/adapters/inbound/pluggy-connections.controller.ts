import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiExcludeController,
} from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { Environment } from '../../../../config/environment.schema.js';
import type { RequestWithId } from '../../../../shared/adapters/inbound/request-id.middleware.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { PluggyConnectionLifecycle } from '../../application/use-cases/pluggy-connection-lifecycle.js';
import {
  connectionIdSchema,
  pluggyCompletionBodySchema,
  pluggyWebhookEventSchema,
} from './connection-input.schema.js';
import {
  CONNECTION_COMPLETION_REQUEST_SCHEMA,
  CONNECTION_SESSION_SCHEMA,
  CONNECTION_VIEW_SCHEMA,
  PLUGGY_WEBHOOK_ACCEPTED_SCHEMA,
  PLUGGY_WEBHOOK_REQUEST_SCHEMA,
} from './connection-openapi.schema.js';
import { ConnectionsProblemDetailsFilter } from './connections-problem-details.filter.js';
import { QStashPluggyWebhookService } from '../outbound/qstash-pluggy-webhook.service.js';
import { QStashUnavailable } from '../outbound/qstash-pluggy-webhook.service.js';
import {
  PROBLEM_DETAILS_RESPONSE,
  REQUEST_ID_RESPONSE_HEADERS,
} from './account-openapi.schema.js';

@ApiTags('connections')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('connections')
export class PluggyConnectionsController {
  constructor(private readonly lifecycle: PluggyConnectionLifecycle) {}

  @Post('pluggy/sessions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start a Pluggy connection session' })
  @ApiCreatedResponse({
    schema: CONNECTION_SESSION_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  start(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
  ) {
    return this.lifecycle.start(context, request.requestId);
  }

  @Post('pluggy/completions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify and record a completed Pluggy connection' })
  @ApiBody({ schema: CONNECTION_COMPLETION_REQUEST_SCHEMA })
  @ApiOkResponse({
    schema: CONNECTION_VIEW_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  complete(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Body() body: unknown,
  ) {
    const { itemId } = pluggyCompletionBodySchema.parse(body);
    return this.lifecycle.complete(context, itemId, request.requestId);
  }

  @Get(':connectionId')
  @ApiOperation({ summary: 'Get connection and consent state' })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: CONNECTION_VIEW_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  get(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('connectionId') rawConnectionId: string,
  ) {
    const connectionId = connectionIdSchema.parse(rawConnectionId);
    return this.lifecycle.get(context, connectionId, request.requestId);
  }

  @Post(':connectionId/disconnect')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Disconnect a Pluggy connection and revoke its consent',
  })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: CONNECTION_VIEW_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  disconnect(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('connectionId') rawConnectionId: string,
  ) {
    const connectionId = connectionIdSchema.parse(rawConnectionId);
    return this.lifecycle.disconnect(context, connectionId, request.requestId);
  }
}

@ApiTags('pluggy-webhooks')
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('webhooks')
export class PluggyWebhookController {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly webhookService: QStashPluggyWebhookService,
  ) {}

  @Post('pluggy')
  @HttpCode(202)
  @ApiOperation({ summary: 'Accept a Pluggy item lifecycle notification' })
  @ApiHeader({ name: 'X-Pluggy-Webhook-Secret', required: true })
  @ApiBody({ schema: PLUGGY_WEBHOOK_REQUEST_SCHEMA })
  @ApiAcceptedResponse({
    description: 'Notification accepted for processing.',
    schema: PLUGGY_WEBHOOK_ACCEPTED_SCHEMA,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  async receive(
    @Headers('x-pluggy-webhook-secret') suppliedSecret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ accepted: true }> {
    const event = pluggyWebhookEventSchema.parse(body);
    const expectedSecret = this.config.get('PLUGGY_WEBHOOK_SECRET', {
      infer: true,
    });
    if (!expectedSecret || !matchesSecret(expectedSecret, suppliedSecret)) {
      if (!expectedSecret) throw new QStashUnavailable();
      throw new UnauthorizedException();
    }
    await this.webhookService.publish(event);
    return { accepted: true };
  }
}

@ApiExcludeController()
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('internal/jobs')
export class PluggyEventWorkerController {
  constructor(
    private readonly webhookService: QStashPluggyWebhookService,
    private readonly lifecycle: PluggyConnectionLifecycle,
  ) {}

  @Post('pluggy-events')
  @HttpCode(200)
  async process(
    @Headers('upstash-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ processed: true }> {
    if (!signature || !request.rawBody) throw new UnauthorizedException();
    const isValid = await this.webhookService.verify(
      signature,
      request.rawBody.toString('utf8'),
    );
    if (!isValid) throw new UnauthorizedException();
    const event = pluggyWebhookEventSchema.parse(body);
    await this.lifecycle.processWebhook(event);
    return { processed: true };
  }
}

function matchesSecret(
  expected: string,
  supplied: string | undefined,
): boolean {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}
