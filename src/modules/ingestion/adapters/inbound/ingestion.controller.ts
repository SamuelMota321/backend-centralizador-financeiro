import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { ConfirmOfxImport } from '../../application/use-cases/confirm-ofx-import.js';
import { CreateOfxImportPreview } from '../../application/use-cases/create-ofx-import-preview.js';
import { GetImportRun } from '../../application/use-cases/get-import-run.js';
import { toImportRunView } from '../../application/ingestion-view.js';
import {
  confirmOfxInputSchema,
  importRunIdSchema,
  ingestionIdempotencyKeySchema,
  previewOfxInputSchema,
  uploadedOfxFileSchema,
} from './ingestion-input.schema.js';
import {
  INGESTION_PROBLEM_DETAILS_RESPONSE,
  IMPORT_RUN_RESPONSE_SCHEMA,
  OFX_CONFIRMATION_REQUEST_SCHEMA,
  OFX_PREVIEW_REQUEST_SCHEMA,
} from './ingestion-openapi.schema.js';
import { IngestionProblemDetailsFilter } from './ingestion-problem-details.filter.js';

const MAX_OFX_FILE_BYTES = 10 * 1024 * 1024;

@ApiTags('ingestions')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(IngestionProblemDetailsFilter)
@Controller()
export class IngestionController {
  constructor(
    private readonly createPreview: CreateOfxImportPreview,
    private readonly confirmImport: ConfirmOfxImport,
    private readonly getImportRun: GetImportRun,
  ) {}

  @Post('ingestions/ofx/previews')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_OFX_FILE_BYTES } }),
  )
  @ApiOperation({ summary: 'Validate an OFX file and create an import preview' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({ schema: OFX_PREVIEW_REQUEST_SCHEMA })
  @ApiCreatedResponse({ schema: IMPORT_RUN_RESPONSE_SCHEMA })
  @ApiBadRequestResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiResponse({ status: 413, ...INGESTION_PROBLEM_DETAILS_RESPONSE })
  @ApiResponse({ status: 415, ...INGESTION_PROBLEM_DETAILS_RESPONSE })
  @ApiResponse({ status: 422, ...INGESTION_PROBLEM_DETAILS_RESPONSE })
  @ApiResponse({ status: 503, ...INGESTION_PROBLEM_DETAILS_RESPONSE })
  @ApiInternalServerErrorResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  previewOfx(
    @CurrentTenantContext() context: TenantContext,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @UploadedFile() uploadedFile: unknown,
  ) {
    const input = previewOfxInputSchema.parse(body);
    const key = ingestionIdempotencyKeySchema.parse(idempotencyKey);
    const file = uploadedOfxFileSchema.parse(uploadedFile);
    return this.createPreview
      .execute(context, file.buffer, input.destinationAccountId, key)
      .then(toImportRunView);
  }

  @Post('ingestions/:importRunId/confirmations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an OFX import preview' })
  @ApiParam({ name: 'importRunId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiBody({ schema: OFX_CONFIRMATION_REQUEST_SCHEMA })
  @ApiOkResponse({ schema: IMPORT_RUN_RESPONSE_SCHEMA })
  @ApiBadRequestResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiResponse({ status: 503, ...INGESTION_PROBLEM_DETAILS_RESPONSE })
  @ApiInternalServerErrorResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  confirmOfx(
    @CurrentTenantContext() context: TenantContext,
    @Param('importRunId') importRunId: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const runId = importRunIdSchema.parse(importRunId);
    const input = confirmOfxInputSchema.parse(body);
    const key = ingestionIdempotencyKeySchema.parse(idempotencyKey);
    return this.confirmImport
      .execute(context, runId, input.destinationAccountId, key)
      .then(toImportRunView);
  }

  @Get('ingestions/:importRunId')
  @ApiOperation({ summary: 'Get an OFX import status, preview, or result' })
  @ApiParam({ name: 'importRunId', type: String, format: 'uuid' })
  @ApiOkResponse({ schema: IMPORT_RUN_RESPONSE_SCHEMA })
  @ApiBadRequestResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(INGESTION_PROBLEM_DETAILS_RESPONSE)
  getStatus(
    @CurrentTenantContext() context: TenantContext,
    @Param('importRunId') importRunId: string,
  ) {
    return this.getImportRun
      .execute(context, importRunIdSchema.parse(importRunId))
      .then(toImportRunView);
  }
}
