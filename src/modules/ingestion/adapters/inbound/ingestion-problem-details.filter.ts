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
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../../../transactions/application/transactions.errors.js';
import {
  ImportRunConflict,
  ImportRunNotFound,
  IngestionIdempotencyKeyExpired,
  IngestionIdempotencyKeyReused,
  IngestionIdempotencyRecordUnavailable,
  IngestionObjectStoreUnavailable,
  InvalidImportRunTransition,
  InvalidOfxDestinationAccount,
  InvalidOfxFile,
  UnsupportedOfxMediaType,
} from '../../domain/ingestion.errors.js';

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
export class IngestionProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(IngestionProblemDetailsFilter.name);

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
    if (isMulterError(exception)) {
      const tooLarge = exception.code === 'LIMIT_FILE_SIZE';
      return {
        type: 'about:blank',
        title: tooLarge ? 'File too large' : 'Invalid request',
        status: tooLarge ? 413 : 400,
        code: 'INVALID_REQUEST',
        detail: tooLarge
          ? 'The OFX file exceeds the supported size.'
          : 'The multipart upload is invalid.',
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
      return problem(404, 'Not found', 'ACCOUNT_NOT_FOUND', 'The requested account was not found.');
    }
    if (exception instanceof TransactionAccountArchived) {
      return problem(409, 'Conflict', 'ACCOUNT_ARCHIVED', 'Archived accounts cannot receive new transactions.');
    }
    if (exception instanceof IngestionIdempotencyKeyReused) {
      return problem(409, 'Conflict', 'IDEMPOTENCY_KEY_REUSED', 'The idempotency key was already used with a different request.');
    }
    if (exception instanceof IngestionIdempotencyKeyExpired) {
      return problem(409, 'Conflict', 'IDEMPOTENCY_KEY_EXPIRED', 'The idempotency key has expired.');
    }
    if (exception instanceof UnsupportedOfxMediaType) {
      return problem(415, 'Unsupported media type', 'INVALID_REQUEST', 'The uploaded file type is not supported.');
    }
    if (exception instanceof InvalidOfxFile) {
      return problem(422, 'Invalid OFX file', 'INVALID_REQUEST', 'The uploaded file is not a supported OFX statement.');
    }
    if (exception instanceof IngestionObjectStoreUnavailable) {
      return problem(503, 'Service unavailable', 'INTERNAL_ERROR', 'The import service is temporarily unavailable.');
    }
    if (
      exception instanceof ImportRunNotFound ||
      exception instanceof ImportRunConflict ||
      exception instanceof InvalidImportRunTransition ||
      exception instanceof InvalidOfxDestinationAccount
    ) {
      const status = exception instanceof ImportRunNotFound ? 404 : 409;
      return problem(status, status === 404 ? 'Not found' : 'Conflict', 'INVALID_REQUEST', 'The import request cannot be completed in its current state.');
    }
    if (exception instanceof IngestionIdempotencyRecordUnavailable) {
      this.logSanitized(exception);
      return internalProblem();
    }

    this.logSanitized(exception);
    return internalProblem();
  }

  private logSanitized(exception: unknown): void {
    this.logger.error(
      exception instanceof Error ? exception.name : 'Unknown ingestion error',
    );
  }
}

function problem(
  status: number,
  title: string,
  code: string,
  detail: string,
): ProblemDetails {
  return { type: 'about:blank', title, status, code, detail };
}

function internalProblem(): ProblemDetails {
  return problem(
    500,
    'Internal server error',
    'INTERNAL_ERROR',
    'An internal error occurred while processing the request.',
  );
}

function toValidationProblems(issue: ZodIssue): ValidationProblem[] {
  if (issue.code === 'custom' && issue.message === 'EMPTY_PATCH') {
    const path = issue.path.map(String).join('.') || '$';
    return [{ path, code: 'EMPTY_PATCH', message: 'Invalid request.' }];
  }
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

function isMulterError(
  value: unknown,
): value is Error & Readonly<{ code: string }> {
  return (
    value instanceof Error &&
    value.name === 'MulterError' &&
    'code' in value &&
    typeof value.code === 'string'
  );
}
