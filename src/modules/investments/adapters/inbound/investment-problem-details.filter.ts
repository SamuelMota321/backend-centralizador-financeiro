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
import { InvestmentNotFound } from '../../application/investment-read.service.js';

@Catch()
export class InvestmentProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(InvestmentProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let title = 'Internal server error';
    let detail = 'An internal error occurred.';
    if (error instanceof ZodError) {
      status = 400;
      code = 'INVALID_REQUEST';
      title = 'Invalid request';
      detail = 'The request contains invalid fields.';
    } else if (error instanceof InvestmentNotFound) {
      status = 404;
      code = 'INVESTMENT_NOT_FOUND';
      title = 'Not found';
      detail = 'The requested investment was not found.';
    } else if (error instanceof UnauthorizedException) {
      status = 401;
      code = 'AUTHENTICATION_REQUIRED';
      title = 'Authentication required';
      detail = 'A valid bearer access token is required.';
      response.setHeader('WWW-Authenticate', 'Bearer');
    } else if (
      error instanceof ForbiddenException ||
      error instanceof IdentityContextUnavailable
    ) {
      status = 403;
      code = 'IDENTITY_CONTEXT_UNAVAILABLE';
      title = 'Forbidden';
      detail = 'The authenticated identity cannot access a local context.';
    }
    if (status === 500)
      this.logger.error(error instanceof Error ? error.name : 'Unknown error');
    response.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title,
      status,
      code,
      detail,
    });
  }
}
