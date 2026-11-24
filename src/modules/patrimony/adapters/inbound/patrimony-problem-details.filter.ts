import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  Logger,
  UnauthorizedException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { IdentityContextUnavailable } from '../../../identity/domain/identity.errors.js';
import { InvalidPatrimony } from '../../domain/patrimony.js';
import { PatrimonyNotFound } from '../../application/patrimony.service.js';

@Catch()
export class PatrimonyProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(PatrimonyProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ZodError || error instanceof InvalidPatrimony) {
      response.status(400).type('application/problem+json').json({
        type: 'about:blank',
        title: 'Invalid request',
        status: 400,
        code: 'INVALID_REQUEST',
        detail: 'The request contains invalid fields.',
      });
      return;
    }
    if (error instanceof PatrimonyNotFound) {
      response.status(404).type('application/problem+json').json({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'PATRIMONY_NOT_FOUND',
        detail: 'The requested record was not found.',
      });
      return;
    }
    if (error instanceof UnauthorizedException) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).type('application/problem+json').json({
        type: 'about:blank',
        title: 'Authentication required',
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        detail: 'A valid bearer access token is required.',
      });
      return;
    }
    if (
      error instanceof ForbiddenException ||
      error instanceof IdentityContextUnavailable
    ) {
      response.status(403).type('application/problem+json').json({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        code: 'IDENTITY_CONTEXT_UNAVAILABLE',
        detail: 'The authenticated identity cannot access a local context.',
      });
      return;
    }
    this.logger.error(error instanceof Error ? error.name : 'Unknown error');
    response.status(500).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An internal error occurred.',
    });
  }
}
