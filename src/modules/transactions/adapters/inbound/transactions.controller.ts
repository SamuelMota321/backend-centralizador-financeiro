import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
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
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Auth0JwtGuard } from '../../../identity/adapters/inbound/auth0-jwt.guard.js';
import { CurrentTenantContext } from '../../../identity/adapters/inbound/tenant-context.decorator.js';
import type {
  TransactionView,
  TransferView,
} from '../../application/transactions-view.js';
import { CreateAccountingTransfer } from '../../application/use-cases/create-accounting-transfer.js';
import { CreateManualTransaction } from '../../application/use-cases/create-manual-transaction.js';
import {
  CREATE_TRANSACTION_SCHEMA,
  CREATE_TRANSFER_SCHEMA,
  TRANSACTION_PROBLEM_DETAILS_RESPONSE,
  TRANSACTION_REQUEST_ID_RESPONSE_HEADERS,
  TRANSACTION_SCHEMA,
  TRANSFER_SCHEMA,
} from './transactions-openapi.schema.js';
import {
  idempotencyKeySchema,
  transactionInputSchema,
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
  ) {}

  @Post('transactions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register a manual income or expense' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1 },
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
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<TransactionView> {
    return this.createManualTransaction.execute(
      context,
      idempotencyKeySchema.parse(idempotencyKey),
      transactionInputSchema.parse(body),
    );
  }

  @Post('transfers')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register an accounting transfer between accounts' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1 },
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
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<TransferView> {
    return this.createAccountingTransfer.execute(
      context,
      idempotencyKeySchema.parse(idempotencyKey),
      transferInputSchema.parse(body),
    );
  }
}
