import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ForbiddenException,
  Logger,
  UnauthorizedException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { PluggyUnavailable } from '../outbound/pluggy-api.client.js';
import { QStashUnavailable } from '../outbound/qstash-pluggy-webhook.service.js';
import {
  ConnectionAlreadyLinked,
  ConnectionWebhookReplayConflict,
} from '../outbound/prisma-connections.repository.js';
import {
  ConnectionNotFound,
  ConnectionRequestConflict,
  InvalidPluggyWebhook,
} from '../../domain/connection.errors.js';
import { IdentityContextUnavailable } from '../../../identity/domain/identity.errors.js';

type ProblemDetails = Readonly<{
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
  detail: string;
}>;

@Catch()
export class ConnectionsProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ConnectionsProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const problem = toProblemDetails(exception);
    if (problem.status === 401) {
      host
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'Bearer');
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(problem.status)
      .type('application/problem+json')
      .json(problem);
    if (problem.status === 500) {
      this.logger.error(
        exception instanceof Error ? exception.name : 'Unknown error',
      );
    }
  }
}

function toProblemDetails(exception: unknown): ProblemDetails {
  if (
    exception instanceof ZodError ||
    exception instanceof BadRequestException
  ) {
    return problem(
      400,
      'Invalid request',
      'INVALID_REQUEST',
      'The request contains invalid fields.',
    );
  }
  if (exception instanceof UnauthorizedException) {
    return problem(
      401,
      'Authentication required',
      'AUTHENTICATION_REQUIRED',
      'A valid credential is required.',
    );
  }
  if (
    exception instanceof ForbiddenException ||
    exception instanceof IdentityContextUnavailable
  ) {
    return problem(
      403,
      'Identity context unavailable',
      'IDENTITY_CONTEXT_UNAVAILABLE',
      'The authenticated identity cannot access a local context.',
    );
  }
  if (exception instanceof ConnectionNotFound) {
    return problem(
      404,
      'Connection not found',
      'CONNECTION_NOT_FOUND',
      'The requested connection was not found.',
    );
  }
  if (
    exception instanceof ConnectionRequestConflict ||
    exception instanceof ConnectionAlreadyLinked ||
    exception instanceof ConnectionWebhookReplayConflict
  ) {
    return problem(
      409,
      'Connection conflict',
      'CONNECTION_CONFLICT',
      'The connection request conflicts with its current state.',
    );
  }
  if (exception instanceof InvalidPluggyWebhook) {
    return problem(
      400,
      'Invalid webhook',
      'INVALID_WEBHOOK',
      'The notification could not be accepted.',
    );
  }
  if (
    exception instanceof PluggyUnavailable ||
    exception instanceof QStashUnavailable
  ) {
    return problem(
      503,
      'Service unavailable',
      'INTEGRATION_UNAVAILABLE',
      'The connection service is temporarily unavailable.',
    );
  }
  return problem(
    500,
    'Internal server error',
    'INTERNAL_ERROR',
    'An internal error occurred while processing the request.',
  );
}

function problem(
  status: number,
  title: string,
  code: string,
  detail: string,
): ProblemDetails {
  return { type: 'about:blank', title, status, code, detail };
}
