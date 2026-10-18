import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiExcludeController,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithId } from '../../../../shared/adapters/inbound/request-id.middleware.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { QStashPluggyWebhookService } from '../../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import {
  pluggyCompletionBodySchema,
  connectionIdSchema,
} from '../../../accounts/adapters/inbound/connection-input.schema.js';
import { ConnectionsProblemDetailsFilter } from '../../../accounts/adapters/inbound/connections-problem-details.filter.js';
import {
  PROBLEM_DETAILS_RESPONSE,
  REQUEST_ID_RESPONSE_HEADERS,
} from '../../../accounts/adapters/inbound/account-openapi.schema.js';
import { CONNECTION_COMPLETION_REQUEST_SCHEMA } from '../../../accounts/adapters/inbound/connection-openapi.schema.js';
import { PluggyInitialImport } from '../../application/use-cases/pluggy-initial-import.js';
import {
  pluggyAccountMappingBodySchema,
  pluggyInitialImportJobSchema,
} from './pluggy-initial-import-input.schema.js';
import {
  PLUGGY_ACCOUNT_MAPPING_REQUEST_SCHEMA,
  PLUGGY_ACCOUNT_MAPPING_RESPONSE_SCHEMA,
  PLUGGY_COMPLETION_ACCEPTED_SCHEMA,
  PLUGGY_CONNECTION_IMPORT_VIEW_SCHEMA,
} from './pluggy-initial-import-openapi.schema.js';

@ApiTags('connections')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('connections')
export class PluggyInitialImportController {
  constructor(private readonly initialImport: PluggyInitialImport) {}

  @Post('pluggy/completions')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Verify a completed Pluggy connection and accept its initial import',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({ schema: CONNECTION_COMPLETION_REQUEST_SCHEMA })
  @ApiAcceptedResponse({
    schema: PLUGGY_COMPLETION_ACCEPTED_SCHEMA,
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
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey) throw new BadRequestException();
    const { itemId } = pluggyCompletionBodySchema.parse(body);
    return this.initialImport.complete(
      context,
      itemId,
      idempotencyKey,
      request.requestId,
    );
  }

  @Get(':connectionId')
  @ApiOperation({
    summary:
      'Get Pluggy connection, consent, data availability and initial import state',
  })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: PLUGGY_CONNECTION_IMPORT_VIEW_SCHEMA,
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
    return this.initialImport.get(context, connectionId, request.requestId);
  }

  @Put(':connectionId/accounts/:providerAccountId/mapping')
  @ApiOperation({
    summary: 'Explicitly link or create a local account for one Pluggy account',
  })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiParam({ name: 'providerAccountId', type: String, format: 'uuid' })
  @ApiBody({ schema: PLUGGY_ACCOUNT_MAPPING_REQUEST_SCHEMA })
  @ApiOkResponse({
    schema: PLUGGY_ACCOUNT_MAPPING_RESPONSE_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  async mapAccount(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('connectionId') rawConnectionId: string,
    @Param('providerAccountId') rawProviderAccountId: string,
    @Body() body: unknown,
  ) {
    const connectionId = connectionIdSchema.parse(rawConnectionId);
    const providerAccountId = connectionIdSchema.parse(rawProviderAccountId);
    const choice = pluggyAccountMappingBodySchema.parse(body);
    const result = await this.initialImport.mapAccount(
      context,
      connectionId,
      providerAccountId,
      choice,
      request.requestId,
    );
    return {
      connectionId,
      providerAccountId,
      accountId: result.accountId,
      initialImport: result.initialImport,
    };
  }
}

@ApiExcludeController()
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('internal/jobs')
export class PluggyInitialImportWorkerController {
  constructor(
    private readonly queue: QStashPluggyWebhookService,
    private readonly initialImport: PluggyInitialImport,
  ) {}

  @Post('pluggy-initial-imports')
  @HttpCode(200)
  async process(
    @Headers('upstash-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ processed: true }> {
    if (!signature || !request.rawBody) throw new UnauthorizedException();
    const isValid = await this.queue.verifyInitialImport(
      signature,
      request.rawBody.toString('utf8'),
    );
    if (!isValid) throw new UnauthorizedException();
    const job = pluggyInitialImportJobSchema.parse(body);
    await this.initialImport.processJob(job);
    return { processed: true };
  }
}
