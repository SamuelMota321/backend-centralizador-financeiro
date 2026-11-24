import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { RequestWithId } from '../../../../shared/adapters/inbound/request-id.middleware.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { PatrimonyService } from '../../application/patrimony.service.js';
import type { PatrimonyData, PatrimonyKind } from '../../domain/patrimony.js';
import {
  collectionSchema,
  pageQuery,
  parseBody,
} from './patrimony-input.schema.js';
import { PatrimonyProblemDetailsFilter } from './patrimony-problem-details.filter.js';
import {
  CREATE_PATRIMONY_SCHEMA,
  PATRIMONY_HISTORY_SCHEMA,
  PATRIMONY_PAGE_SCHEMA,
  PATRIMONY_PROBLEM_RESPONSE,
  PATRIMONY_VIEW_SCHEMA,
  UPDATE_PATRIMONY_SCHEMA,
} from './patrimony-openapi.schema.js';

const collectionKind: Record<
  'assets' | 'financings' | 'liabilities',
  PatrimonyKind
> = {
  assets: 'asset',
  financings: 'financing',
  liabilities: 'liability',
};

@ApiTags('patrimony')
@ApiBearerAuth('auth0')
@ApiParam({ name: 'collection', enum: ['assets', 'financings', 'liabilities'] })
@ApiBadRequestResponse(PATRIMONY_PROBLEM_RESPONSE)
@ApiUnauthorizedResponse(PATRIMONY_PROBLEM_RESPONSE)
@ApiForbiddenResponse(PATRIMONY_PROBLEM_RESPONSE)
@ApiNotFoundResponse(PATRIMONY_PROBLEM_RESPONSE)
@UseGuards(Auth0JwtGuard)
@UseFilters(PatrimonyProblemDetailsFilter)
@Controller('patrimony/:collection')
export class PatrimonyController {
  constructor(private readonly service: PatrimonyService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a manual asset, financing, or liability' })
  @ApiBody({ schema: CREATE_PATRIMONY_SCHEMA })
  @ApiCreatedResponse({ schema: PATRIMONY_VIEW_SCHEMA })
  create(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('collection') collection: string,
    @Body() body: unknown,
  ) {
    const selected = collectionSchema.parse(collection);
    return this.service.create(
      context,
      collectionKind[selected],
      parseBody(selected, body) as PatrimonyData,
      request.requestId,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List manual patrimony records for the authenticated tenant',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: PATRIMONY_PAGE_SCHEMA })
  list(
    @CurrentTenantContext() context: TenantContext,
    @Param('collection') collection: string,
    @Query() query: unknown,
  ) {
    const selected = collectionSchema.parse(collection);
    const { page, pageSize } = pageQuery.parse(query);
    return this.service.list(context, collectionKind[selected], page, pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a manual patrimony record' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PATRIMONY_VIEW_SCHEMA })
  get(
    @CurrentTenantContext() context: TenantContext,
    @Param('collection') collection: string,
    @Param('id') id: string,
  ) {
    return this.service.get(
      context,
      collectionKind[collectionSchema.parse(collection)],
      id,
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a manual patrimony record' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: UPDATE_PATRIMONY_SCHEMA })
  @ApiOkResponse({ schema: PATRIMONY_VIEW_SCHEMA })
  update(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('collection') collection: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const selected = collectionSchema.parse(collection);
    return this.service.update(
      context,
      collectionKind[selected],
      id,
      parseBody(selected, body, true),
      request.requestId,
    );
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'List prior and current versions of a manual patrimony record',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: PATRIMONY_HISTORY_SCHEMA })
  history(
    @CurrentTenantContext() context: TenantContext,
    @Param('collection') collection: string,
    @Param('id') id: string,
  ) {
    return this.service.history(
      context,
      collectionKind[collectionSchema.parse(collection)],
      id,
    );
  }
}
