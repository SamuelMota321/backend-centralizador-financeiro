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
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiExcludeController,
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
import { z } from 'zod';
import type { RequestWithId } from '../../../../shared/adapters/inbound/request-id.middleware.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { PluggyConnectionLifecycle } from '../../../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import { connectionIdSchema } from '../../../accounts/adapters/inbound/connection-input.schema.js';
import { ConnectionsProblemDetailsFilter } from '../../../accounts/adapters/inbound/connections-problem-details.filter.js';
import {
  PROBLEM_DETAILS_RESPONSE,
  REQUEST_ID_RESPONSE_HEADERS,
} from '../../../accounts/adapters/inbound/account-openapi.schema.js';
import { QStashPluggyWebhookService } from '../../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import { PluggySynchronization } from '../../application/pluggy-synchronization.js';
import {
  SYNC_LATEST_SCHEMA,
  SYNC_RUN_SCHEMA,
  UPDATE_SESSION_SCHEMA,
} from './pluggy-sync-openapi.schema.js';

const syncJobSchema = z
  .object({
    runId: z.uuid(),
    tenantId: z.uuid(),
    userId: z.uuid(),
  })
  .strict();

@ApiTags('connections')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('connections')
export class PluggySyncController {
  constructor(
    private readonly synchronization: PluggySynchronization,
    private readonly lifecycle: PluggyConnectionLifecycle,
  ) {}

  @Post(':connectionId/sync-runs')
  @HttpCode(202)
  @ApiOperation({ summary: 'Accept a manual Pluggy synchronization' })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiAcceptedResponse({
    schema: SYNC_RUN_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(PROBLEM_DETAILS_RESPONSE)
  requestManual(
    @CurrentTenantContext() context: TenantContext,
    @Param('connectionId') rawConnectionId: string,
  ) {
    return this.synchronization.requestManual(
      context,
      connectionIdSchema.parse(rawConnectionId),
    );
  }

  @Get(':connectionId/sync-runs/latest')
  @ApiOperation({
    summary: 'Get latest Pluggy synchronization and last reconciled run',
  })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: SYNC_LATEST_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  latest(
    @CurrentTenantContext() context: TenantContext,
    @Param('connectionId') rawConnectionId: string,
  ) {
    return this.synchronization.latest(
      context,
      connectionIdSchema.parse(rawConnectionId),
    );
  }

  @Get(':connectionId/sync-runs/:runId')
  @ApiOperation({ summary: 'Get one Pluggy synchronization run' })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiParam({ name: 'runId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: SYNC_RUN_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  get(
    @CurrentTenantContext() context: TenantContext,
    @Param('connectionId') rawConnectionId: string,
    @Param('runId') rawRunId: string,
  ) {
    return this.synchronization.get(
      context,
      connectionIdSchema.parse(rawConnectionId),
      connectionIdSchema.parse(rawRunId),
    );
  }

  @Post(':connectionId/update-session')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start Connect Widget update for a Pluggy Item' })
  @ApiParam({ name: 'connectionId', type: String, format: 'uuid' })
  @ApiOkResponse({
    schema: UPDATE_SESSION_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(PROBLEM_DETAILS_RESPONSE)
  @ApiServiceUnavailableResponse(PROBLEM_DETAILS_RESPONSE)
  updateSession(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('connectionId') rawConnectionId: string,
  ) {
    return this.lifecycle.startUpdate(
      context,
      connectionIdSchema.parse(rawConnectionId),
      request.requestId,
    );
  }
}

@ApiExcludeController()
@UseFilters(ConnectionsProblemDetailsFilter)
@Controller('internal/jobs')
export class PluggySyncWorkerController {
  constructor(
    private readonly queue: QStashPluggyWebhookService,
    private readonly synchronization: PluggySynchronization,
  ) {}

  @Post('pluggy-sync-runs')
  @HttpCode(200)
  async process(
    @Headers('upstash-signature') signature: string | undefined,
    @Headers('upstash-retried') retried: string | undefined,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    if (
      !signature ||
      !request.rawBody ||
      !(await this.queue.verifySync(
        signature,
        request.rawBody.toString('utf8'),
      ))
    )
      throw new UnauthorizedException();
    const retries = Number(retried ?? 0);
    if (!Number.isInteger(retries) || retries < 0)
      throw new UnauthorizedException();
    await this.synchronization.processJob(syncJobSchema.parse(body), retries);
    return { processed: true };
  }

  @Post('pluggy-daily-sync')
  @HttpCode(200)
  async daily(
    @Headers('upstash-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (
      !signature ||
      !request.rawBody ||
      !(await this.queue.verifyDailySync(
        signature,
        request.rawBody.toString('utf8'),
      ))
    )
      throw new UnauthorizedException();
    await this.synchronization.enqueueDaily();
    return { processed: true };
  }
}
