import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
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
import type {
  CategoryPage,
  CategoryRulePage,
  CategoryRuleView,
  CategoryView,
  TransactionPage,
  TransactionView,
  TransferView,
} from '../../application/transactions-view.js';
import { CreateCategory } from '../../application/use-cases/create-category.js';
import { CreateCategoryRule } from '../../application/use-cases/create-category-rule.js';
import { CreateAccountingTransfer } from '../../application/use-cases/create-accounting-transfer.js';
import { CreateManualTransaction } from '../../application/use-cases/create-manual-transaction.js';
import { DeactivateCategory } from '../../application/use-cases/deactivate-category.js';
import { CategoryRuleLifecycle } from '../../application/use-cases/category-rule-lifecycle.js';
import { ListCategories } from '../../application/use-cases/list-categories.js';
import { ListCategoryRules } from '../../application/use-cases/list-category-rules.js';
import { ListTransactions } from '../../application/use-cases/list-transactions.js';
import { UpdateCategory } from '../../application/use-cases/update-category.js';
import { UpdateCategoryRule } from '../../application/use-cases/update-category-rule.js';
import { UpdateTransactionCategory } from '../../application/use-cases/update-transaction-category.js';
import {
  CREATE_TRANSACTION_SCHEMA,
  CREATE_TRANSFER_SCHEMA,
  CATEGORY_PAGE_SCHEMA,
  CATEGORY_RULE_PAGE_SCHEMA,
  CATEGORY_RULE_SCHEMA,
  CATEGORY_SCHEMA,
  CREATE_CATEGORY_RULE_SCHEMA,
  CREATE_CATEGORY_SCHEMA,
  TRANSACTION_PROBLEM_DETAILS_RESPONSE,
  TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  TRANSACTION_PAGE_SCHEMA,
  TRANSACTION_SCHEMA,
  TRANSFER_SCHEMA,
  UPDATE_CATEGORY_RULE_SCHEMA,
  UPDATE_CATEGORY_SCHEMA,
  UPDATE_TRANSACTION_CATEGORY_SCHEMA,
} from './transactions-openapi.schema.js';
import {
  canonicalUuidSchema,
  categoryInputSchema,
  categoryRuleInputSchema,
  categoryRuleUpdateInputSchema,
  idempotencyKeySchema,
  noBodySchema,
  paginationQuerySchema,
  transactionCategoryInputSchema,
  transactionInputSchema,
  transactionIdSchema,
  transferInputSchema,
} from './transactions-input.schema.js';
import { TransactionsProblemDetailsFilter } from './transactions-problem-details.filter.js';

@ApiTags('transactions')
@ApiBearerAuth('auth0')
@UseGuards(Auth0JwtGuard)
@UseFilters(TransactionsProblemDetailsFilter)
@Controller()
export class TransactionsController {
  constructor(
    private readonly createManualTransaction: CreateManualTransaction,
    private readonly createAccountingTransfer: CreateAccountingTransfer,
    private readonly listTransactions: ListTransactions,
    private readonly updateTransactionCategory: UpdateTransactionCategory,
    private readonly listCategories: ListCategories,
    private readonly createCategory: CreateCategory,
    private readonly updateCategory: UpdateCategory,
    private readonly deactivateCategory: DeactivateCategory,
    private readonly listCategoryRules: ListCategoryRules,
    private readonly createCategoryRule: CreateCategoryRule,
    private readonly updateCategoryRule: UpdateCategoryRule,
    private readonly categoryRuleLifecycle: CategoryRuleLifecycle,
  ) {}

  @Get('transactions')
  @ApiOperation({ summary: 'List transactions for the authenticated tenant' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    schema: TRANSACTION_PAGE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  listTransactionsEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<TransactionPage> {
    return this.listTransactions.execute(
      context,
      paginationQuerySchema.parse(query),
    );
  }

  @Post('transactions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a manual income or expense' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: CREATE_TRANSACTION_SCHEMA })
  @ApiCreatedResponse({
    schema: TRANSACTION_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  createTransaction(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<TransactionView> {
    return this.createManualTransaction.execute(
      context,
      idempotencyKeySchema.parse(idempotencyKey),
      transactionInputSchema.parse(body),
      request.requestId,
    );
  }

  @Post('transfers')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register an accounting transfer between accounts' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: CREATE_TRANSFER_SCHEMA })
  @ApiCreatedResponse({
    schema: TRANSFER_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  createTransfer(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<TransferView> {
    return this.createAccountingTransfer.execute(
      context,
      idempotencyKeySchema.parse(idempotencyKey),
      transferInputSchema.parse(body),
      request.requestId,
    );
  }

  @Patch('transactions/:transactionId/category')
  @HttpCode(200)
  @ApiOperation({ summary: 'Assign or correct a transaction categorization' })
  @ApiParam({ name: 'transactionId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: UPDATE_TRANSACTION_CATEGORY_SCHEMA })
  @ApiOkResponse({
    schema: TRANSACTION_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  updateTransactionCategoryEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('transactionId') transactionId: string,
    @Body() body: unknown,
  ): Promise<TransactionView> {
    return this.updateTransactionCategory.execute(
      context,
      transactionIdSchema.parse(transactionId),
      request.requestId,
      transactionCategoryInputSchema.parse(body),
    );
  }

  @Get('categories')
  @ApiOperation({ summary: 'List categories for the authenticated tenant' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    schema: CATEGORY_PAGE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  listCategoriesEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<CategoryPage> {
    return this.listCategories.execute(
      context,
      paginationQuerySchema.parse(query),
    );
  }

  @Post('categories')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a personal category' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: CREATE_CATEGORY_SCHEMA })
  @ApiCreatedResponse({
    schema: CATEGORY_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  createCategoryEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Body() body: unknown,
  ): Promise<CategoryView> {
    return this.createCategory.execute(
      context,
      categoryInputSchema.parse(body),
      request.requestId,
    );
  }

  @Patch('categories/:categoryId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rename a personal category' })
  @ApiParam({ name: 'categoryId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: UPDATE_CATEGORY_SCHEMA })
  @ApiOkResponse({
    schema: CATEGORY_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  updateCategoryEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ): Promise<CategoryView> {
    return this.updateCategory.execute(
      context,
      canonicalUuidSchema.parse(categoryId),
      request.requestId,
      categoryInputSchema.parse(body),
    );
  }

  @Post('categories/:categoryId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a personal category' })
  @ApiParam({ name: 'categoryId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: CATEGORY_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  deactivateCategoryEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ): Promise<CategoryView> {
    noBodySchema.parse(body);
    return this.deactivateCategory.execute(
      context,
      canonicalUuidSchema.parse(categoryId),
      request.requestId,
    );
  }

  @Get('category-rules')
  @ApiOperation({ summary: 'List personal categorization rules' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  @ApiOkResponse({
    schema: CATEGORY_RULE_PAGE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  listCategoryRulesEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: unknown,
  ): Promise<CategoryRulePage> {
    return this.listCategoryRules.execute(
      context,
      paginationQuerySchema.parse(query),
    );
  }

  @Post('category-rules')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a personal categorization rule' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: CREATE_CATEGORY_RULE_SCHEMA })
  @ApiCreatedResponse({
    schema: CATEGORY_RULE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  createCategoryRuleEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Body() body: unknown,
  ): Promise<CategoryRuleView> {
    return this.createCategoryRule.execute(
      context,
      categoryRuleInputSchema.parse(body),
      request.requestId,
    );
  }

  @Patch('category-rules/:ruleId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Edit a personal categorization rule' })
  @ApiParam({ name: 'ruleId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({ schema: UPDATE_CATEGORY_RULE_SCHEMA })
  @ApiOkResponse({
    schema: CATEGORY_RULE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  updateCategoryRuleEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<CategoryRuleView> {
    return this.updateCategoryRule.execute(
      context,
      canonicalUuidSchema.parse(ruleId),
      request.requestId,
      categoryRuleUpdateInputSchema.parse(body),
    );
  }

  @Post('category-rules/:ruleId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a personal categorization rule' })
  @ApiParam({ name: 'ruleId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: CATEGORY_RULE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  activateCategoryRuleEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<CategoryRuleView> {
    noBodySchema.parse(body);
    return this.categoryRuleLifecycle.execute(
      context,
      canonicalUuidSchema.parse(ruleId),
      'activate',
      request.requestId,
    );
  }

  @Post('category-rules/:ruleId/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate a personal categorization rule' })
  @ApiParam({ name: 'ruleId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: CATEGORY_RULE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  deactivateCategoryRuleEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ): Promise<CategoryRuleView> {
    noBodySchema.parse(body);
    return this.categoryRuleLifecycle.execute(
      context,
      canonicalUuidSchema.parse(ruleId),
      'deactivate',
      request.requestId,
    );
  }

  @Delete('category-rules/:ruleId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a personal categorization rule' })
  @ApiParam({ name: 'ruleId', type: String, format: 'uuid' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    schema: CATEGORY_RULE_SCHEMA,
    headers: TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  })
  @ApiBadRequestResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiUnauthorizedResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiForbiddenResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiNotFoundResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiConflictResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  @ApiInternalServerErrorResponse(TRANSACTION_PROBLEM_DETAILS_RESPONSE)
  removeCategoryRuleEndpoint(
    @CurrentTenantContext() context: TenantContext,
    @Req() request: RequestWithId,
    @Param('ruleId') ruleId: string,
  ): Promise<CategoryRuleView> {
    return this.categoryRuleLifecycle.execute(
      context,
      canonicalUuidSchema.parse(ruleId),
      'remove',
      request.requestId,
    );
  }
}
