import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '../../application/request-id.js';

type JsonParserError = Readonly<{
  type?: unknown;
  status?: unknown;
}>;

export function jsonParserProblemDetailsMiddleware(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!isJsonParserError(error)) {
    next(error);
    return;
  }

  const requestId = resolveRequestId(request.get(REQUEST_ID_HEADER));
  response.setHeader(REQUEST_ID_HEADER, requestId);
  response
    .status(400)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: 'Invalid request',
      status: 400,
      code: 'INVALID_REQUEST',
      detail: 'The request body contains invalid JSON.',
      errors: [
        {
          path: '$',
          code: 'INVALID_JSON',
          message: 'Invalid JSON body.',
        },
      ],
    });
}

function isJsonParserError(error: unknown): error is JsonParserError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as JsonParserError;
  return candidate.type === 'entity.parse.failed' && candidate.status === 400;
}
