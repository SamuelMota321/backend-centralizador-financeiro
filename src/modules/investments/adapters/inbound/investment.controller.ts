import {
  Controller,
  Get,
  Param,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { InvestmentReadService } from '../../application/investment-read.service.js';
import {
  INVESTMENT_MOVEMENTS_SCHEMA,
  INVESTMENT_PAGE_SCHEMA,
  INVESTMENT_PROBLEM_RESPONSE,
} from './investment-openapi.schema.js';
import { InvestmentProblemDetailsFilter } from './investment-problem-details.filter.js';

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@ApiTags('investments')
@ApiBearerAuth('auth0')
@ApiBadRequestResponse(INVESTMENT_PROBLEM_RESPONSE)
@ApiUnauthorizedResponse(INVESTMENT_PROBLEM_RESPONSE)
@ApiForbiddenResponse(INVESTMENT_PROBLEM_RESPONSE)
@UseGuards(Auth0JwtGuard)
@UseFilters(InvestmentProblemDetailsFilter)
@Controller('investments')
export class InvestmentController {
  constructor(private readonly service: InvestmentReadService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated user investment portfolio' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: INVESTMENT_PAGE_SCHEMA })
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ) {
    const { page, pageSize } = pageQuery.parse(query);
    return this.service.list(context, page, pageSize);
  }

  @Get(':id/movements')
  @ApiOperation({
    summary: 'List available movements for one investment position',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ schema: INVESTMENT_MOVEMENTS_SCHEMA })
  @ApiNotFoundResponse(INVESTMENT_PROBLEM_RESPONSE)
  movements(
    @CurrentTenantContext() context: TenantContext,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const { page, pageSize } = pageQuery.parse(query);
    return this.service.movements(context, z.uuid().parse(id), page, pageSize);
  }
}
