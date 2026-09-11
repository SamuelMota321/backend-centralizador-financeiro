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
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiHeader,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import type { RequestWithId } from '../../../../shared/adapters/inbound/request-id.middleware.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  AccountPage,
  AccountView,
} from '../../application/account-view.js';
import { CreateManualAccount } from '../../application/use-cases/create-manual-account.js';
import { DeactivateAccount } from '../../application/use-cases/deactivate-account.js';
import { ListAccounts } from '../../application/use-cases/list-accounts.js';
import { UpdateAccount } from '../../application/use-cases/update-account.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import {
  canonicalAccountIdSchema,
  deactivateAccountBodySchema,
  manualAccountInputSchema,
  updateAccountInputSchema,
} from './account-input.schema.js';
import {
  ACCOUNT_PAGE_SCHEMA,
  ACCOUNT_SCHEMA,
  CREATE_ACCOUNT_SCHEMA,
  PROBLEM_DETAILS_SCHEMA,
  REQUEST_ID_RESPONSE_HEADERS,
  UPDATE_ACCOUNT_SCHEMA,
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
    private readonly updateAccount: UpdateAccount,
    private readonly deactivateAccount: DeactivateAccount,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a manual account' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: CREATE_ACCOUNT_SCHEMA })
  @ApiCreatedResponse({
    schema: ACCOUNT_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiUnauthorizedResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiForbiddenResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiConflictResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiInternalServerErrorResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
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
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    schema: ACCOUNT_PAGE_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiUnauthorizedResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiForbiddenResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiInternalServerErrorResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<AccountPage> {
    return this.listAccounts.execute(context, accountQuerySchema.parse(query));
  }

  @Patch(':accountId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an account' })
  @ApiParam({ name: 'accountId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: UPDATE_ACCOUNT_SCHEMA })
  @ApiOkResponse({
    schema: ACCOUNT_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiUnauthorizedResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiForbiddenResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiNotFoundResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiConflictResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiInternalServerErrorResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  update(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<AccountView> {
    return this.updateAccount.execute(
      context,
      canonicalAccountIdSchema.parse(accountId),
      request.requestId,
      updateAccountInputSchema.parse(body),
    );
  }

  @Post(':accountId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate an account' })
  @ApiParam({ name: 'accountId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: ACCOUNT_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiUnauthorizedResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiForbiddenResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiNotFoundResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiInternalServerErrorResponse({
    schema: PROBLEM_DETAILS_SCHEMA,
    headers: REQUEST_ID_RESPONSE_HEADERS,
  })
  deactivate(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('accountId') accountId: string,
    @Body() body: unknown,
  ): Promise<AccountView> {
    deactivateAccountBodySchema.parse(body);
    return this.deactivateAccount.execute(
      context,
      canonicalAccountIdSchema.parse(accountId),
      request.requestId,
    );
  }
}
