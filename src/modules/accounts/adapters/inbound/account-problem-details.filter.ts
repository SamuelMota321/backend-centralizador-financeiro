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
import {
  AccountHasActiveCategoryRules,
  PossibleConnectedAccountDuplicate,
} from '../../application/accounts.errors.js';
import { IdentityContextUnavailable } from '../../../identity/domain/identity.errors.js';
import {
  AccountArchived,
  AccountNotFound,
  BalanceReferencePairRequired,
  ConnectedAccountReadOnly,
} from '../../domain/account.errors.js';

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
  errors?: ValidationProblem[];
  candidates?: PossibleConnectedAccountDuplicate['candidates'];
}>;

@Catch()
export class AccountProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AccountProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblemDetails(exception);
    if (problem.status === 401) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }
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
    if (exception instanceof PossibleConnectedAccountDuplicate) {
      return {
        type: 'about:blank',
        title: 'Possible connected account duplicate',
        status: 409,
        code: 'POSSIBLE_CONNECTED_ACCOUNT_DUPLICATE',
        detail:
          'Confirm the possible duplicate to create a separate manual account.',
        candidates: exception.candidates,
      };
    }
    if (exception instanceof AccountHasActiveCategoryRules) {
      return {
        type: 'about:blank',
        title: 'Category rule conflict',
        status: 409,
        code: 'CATEGORY_RULE_CONFLICT',
        detail:
          'The account is referenced by one or more active category rules.',
      };
    }
    if (exception instanceof AccountNotFound) {
      return {
        type: 'about:blank',
        title: 'Account not found',
        status: 404,
        code: 'ACCOUNT_NOT_FOUND',
        detail: 'The requested account was not found.',
      };
    }
    if (exception instanceof AccountArchived) {
      return {
        type: 'about:blank',
        title: 'Account archived',
        status: 409,
        code: 'ACCOUNT_ARCHIVED',
        detail: 'Archived accounts cannot be updated.',
      };
    }
    if (exception instanceof ConnectedAccountReadOnly) {
      return {
        type: 'about:blank',
        title: 'Connected account is read-only',
        status: 409,
        code: 'CONNECTED_ACCOUNT_READ_ONLY',
        detail: 'Connected accounts cannot be updated here.',
      };
    }
    if (exception instanceof BalanceReferencePairRequired) {
      return {
        type: 'about:blank',
        title: 'Invalid request',
        status: 400,
        code: 'INVALID_REQUEST',
        detail: 'Initial balance and reference date must be provided together.',
        errors: [
          {
            path: 'initialBalance',
            code: 'BALANCE_REFERENCE_PAIR_REQUIRED',
            message: 'Both balance reference fields are required.',
          },
        ],
      };
    }

    this.logger.error(sanitizeError(exception));
    return {
      type: 'about:blank',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An internal error occurred while processing the request.',
    };
  }
}

function toValidationProblems(issue: ZodIssue): ValidationProblem[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: key,
      code: IMMUTABLE_FIELDS.has(key) ? 'IMMUTABLE_FIELD' : 'UNKNOWN_FIELD',
      message: IMMUTABLE_FIELDS.has(key)
        ? 'Field cannot be changed.'
        : 'Unknown field.',
    }));
  }

  const path = issue.path.map(String).join('.') || '$';
  if (issue.code === 'custom' && SAFE_VALIDATION_CODES.has(issue.message)) {
    return [{ path, code: issue.message, message: 'Invalid request.' }];
  }
  const code =
    issue.code === 'too_small' || issue.code === 'too_big'
      ? 'OUT_OF_RANGE'
      : issue.code === 'invalid_type'
        ? 'INVALID_TYPE'
        : 'INVALID_VALUE';
  return [{ path, code, message: 'Invalid value.' }];
}

const IMMUTABLE_FIELDS = new Set([
  'tenantId',
  'origin',
  'currencyCode',
  'externalProvider',
  'externalAccountId',
  'id',
  'createdAt',
  'updatedAt',
  'archivedAt',
]);

const SAFE_VALIDATION_CODES = new Set([
  'EMPTY_PATCH',
  'BALANCE_REFERENCE_PAIR_REQUIRED',
]);

function sanitizeError(exception: unknown): string {
  if (!(exception instanceof Error)) {
    return 'Unknown non-error exception';
  }

  const code =
    'code' in exception &&
    typeof exception.code === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(exception.code)
      ? ` code=${exception.code}`
      : '';
  const stackFrames = exception.stack?.split(/\r?\n/).slice(1).join('\n');
  return `${exception.name}${code}${stackFrames ? `\n${stackFrames}` : ''}`;
}
