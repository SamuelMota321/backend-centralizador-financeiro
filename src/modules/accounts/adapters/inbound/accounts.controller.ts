import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  AccountPage,
  AccountView,
} from '../../application/account-view.js';
import { CreateManualAccount } from '../../application/use-cases/create-manual-account.js';
import { ListAccounts } from '../../application/use-cases/list-accounts.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import { manualAccountInputSchema } from './account-input.schema.js';
import {
  ACCOUNT_PAGE_SCHEMA,
  ACCOUNT_SCHEMA,
  CREATE_ACCOUNT_SCHEMA,
  PROBLEM_DETAILS_SCHEMA,
} from './account-openapi.schema.js';
import { AccountProblemDetailsFilter } from './account-problem-details.filter.js';
import { accountQuerySchema } from './account-query.schema.js';

@ApiTags('accounts')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly createManualAccount: CreateManualAccount,
    private readonly listAccounts: ListAccounts,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a manual account' })
  @ApiBody({ schema: CREATE_ACCOUNT_SCHEMA })
  @ApiCreatedResponse({ schema: ACCOUNT_SCHEMA })
  @ApiBadRequestResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiUnauthorizedResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiForbiddenResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiConflictResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiInternalServerErrorResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  create(
    @CurrentTenantContext() context: TenantContext,
    @Body() body: unknown,
  ): Promise<AccountView> {
    return this.createManualAccount.execute(
      context,
      manualAccountInputSchema.parse(body),
    );
  }

  @Get()
  @ApiOperation({
    summary: 'List active accounts for the authenticated tenant',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({ schema: ACCOUNT_PAGE_SCHEMA })
  @ApiBadRequestResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiUnauthorizedResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiForbiddenResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  @ApiInternalServerErrorResponse({ schema: PROBLEM_DETAILS_SCHEMA })
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<AccountPage> {
    return this.listAccounts.execute(context, accountQuerySchema.parse(query));
  }
}
