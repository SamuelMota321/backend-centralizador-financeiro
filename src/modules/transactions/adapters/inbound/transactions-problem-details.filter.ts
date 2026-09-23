import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  Logger,
  UnauthorizedException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError, type ZodIssue } from 'zod';
import { IdentityContextUnavailable } from '../../../identity/domain/identity.errors.js';
import {
  IdempotencyKeyExpired,
  IdempotencyKeyReused,
  IdempotencyRecordUnavailable,
  InvalidTransactionRequest,
  CategoryArchived,
  CategoryNotFound,
  TransactionNotFound,
  TransactionAccountArchived,
  TransactionAccountNotFound,
  TransactionsTenantMismatch,
  TransferAccountsMustDiffer,
} from '../../application/transactions.errors.js';
import {
  InvalidTransactionAmount,
  InvalidTransactionDate,
  InvalidTransactionState,
  InvalidTransactionType,
  InvalidCategoryName,
  InvalidCategoryRule,
  InvalidCategoryState,
  CategoryRuleRemoved,
  TransactionCategorizationNotAllowed,
  CategoryRuleNotFound,
} from '../../domain/transactions.errors.js';

type ValidationProblem = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

type ProblemDetails = Readonly<{
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: readonly ValidationProblem[];
}>;

@Catch()
export class TransactionsProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(TransactionsProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblemDetails(exception);
    if (problem.status === 401)
      response.setHeader('WWW-Authenticate', 'Bearer');
    response
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
  }

  private toProblemDetails(exception: unknown): ProblemDetails {
    if (exception instanceof ZodError) {
      return {
        type: 'about:blank',
        title: 'Invalid request',
        status: 400,
        code: 'INVALID_REQUEST',
        detail: 'The request contains invalid fields.',
        errors: exception.issues.flatMap(toValidationProblems),
      };
    }
    if (exception instanceof UnauthorizedException) {
      return {
        type: 'about:blank',
        title: 'Authentication required',
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        detail: 'A valid bearer access token is required.',
      };
    }
    if (
      exception instanceof ForbiddenException ||
      exception instanceof IdentityContextUnavailable
    ) {
      return {
        type: 'about:blank',
        title: 'Identity context unavailable',
        status: 403,
        code: 'IDENTITY_CONTEXT_UNAVAILABLE',
        detail: 'The authenticated identity cannot access a local context.',
      };
    }
    if (exception instanceof TransactionAccountNotFound) {
      return {
        type: 'about:blank',
        title: 'Account not found',
        status: 404,
        code: 'ACCOUNT_NOT_FOUND',
        detail: 'The requested account was not found.',
      };
    }
    if (exception instanceof TransactionAccountArchived) {
      return {
        type: 'about:blank',
        title: 'Account archived',
        status: 409,
        code: 'ACCOUNT_ARCHIVED',
        detail: 'Archived accounts cannot receive new transactions.',
      };
    }
    if (exception instanceof TransactionNotFound) {
      return {
        type: 'about:blank',
        title: 'Transaction not found',
        status: 404,
        code: 'TRANSACTION_NOT_FOUND',
        detail: 'The requested transaction was not found.',
      };
    }
    if (exception instanceof CategoryNotFound) {
      return {
        type: 'about:blank',
        title: 'Category not found',
        status: 404,
        code: 'CATEGORY_NOT_FOUND',
        detail: 'The requested category was not found.',
      };
    }
    if (exception instanceof CategoryRuleNotFound) {
      return {
        type: 'about:blank',
        title: 'Category rule not found',
        status: 404,
        code: 'CATEGORY_RULE_NOT_FOUND',
        detail: 'The requested category rule was not found.',
      };
    }
    if (exception instanceof CategoryArchived) {
      return problem409(
        'CATEGORY_ARCHIVED',
        'Archived categories cannot be assigned or used by new rules.',
      );
    }
    if (exception instanceof CategoryRuleRemoved) {
      return problem409(
        'CATEGORY_RULE_CONFLICT',
        'Removed category rules cannot be reactivated or edited.',
      );
    }
    if (exception instanceof TransferAccountsMustDiffer) {
      return problem400(
        'TRANSFER_ACCOUNTS_MUST_DIFFER',
        'A transfer requires two different accounts.',
      );
    }
    if (exception instanceof IdempotencyKeyReused) {
      return problem409(
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key was already used with a different request.',
      );
    }
    if (exception instanceof IdempotencyKeyExpired) {
      return problem409(
        'IDEMPOTENCY_KEY_EXPIRED',
        'The idempotency key has expired.',
      );
    }
    if (
      exception instanceof InvalidTransactionAmount ||
      exception instanceof InvalidTransactionDate ||
      exception instanceof InvalidTransactionType ||
      exception instanceof InvalidTransactionState ||
      exception instanceof InvalidTransactionRequest ||
      exception instanceof InvalidCategoryName ||
      exception instanceof InvalidCategoryRule ||
      exception instanceof InvalidCategoryState
    ) {
      return problem400(
        'INVALID_REQUEST',
        'The request contains invalid fields.',
      );
    }
    if (exception instanceof TransactionCategorizationNotAllowed) {
      return problem409(
        'TRANSACTION_CATEGORIZATION_NOT_ALLOWED',
        'The transaction cannot receive a category in its current state.',
      );
    }

    if (
      exception instanceof TransactionsTenantMismatch ||
      exception instanceof IdempotencyRecordUnavailable
    ) {
      this.logger.error(sanitizeError(exception));
      return internalProblem();
    }

    this.logger.error(sanitizeError(exception));
    return internalProblem();
  }
}

function problem400(code: string, detail: string): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Invalid request',
    status: 400,
    code,
    detail,
  };
}

function problem409(code: string, detail: string): ProblemDetails {
  return { type: 'about:blank', title: 'Conflict', status: 409, code, detail };
}

function internalProblem(): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail: 'An internal error occurred while processing the request.',
  };
}

function toValidationProblems(issue: ZodIssue): ValidationProblem[] {
  const path = issue.path.map(String).join('.') || '$';
  const code =
    issue.code === 'too_small' || issue.code === 'too_big'
      ? 'OUT_OF_RANGE'
      : issue.code === 'invalid_type'
        ? 'INVALID_TYPE'
        : issue.code === 'unrecognized_keys'
          ? 'UNKNOWN_FIELD'
          : 'INVALID_VALUE';
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: key,
      code,
      message: 'Unknown field.',
    }));
  }
  return [{ path, code, message: 'Invalid value.' }];
}

function sanitizeError(exception: unknown): string {
  if (!(exception instanceof Error)) return 'Unknown non-error exception';
  const stackFrames = exception.stack?.split(/\r?\n/).slice(1).join('\n');
  return `${exception.name}${stackFrames ? `\n${stackFrames}` : ''}`;
}
