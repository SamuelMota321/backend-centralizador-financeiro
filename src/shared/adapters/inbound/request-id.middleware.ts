import type { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from '../../application/request-id.js';

export type RequestWithId = Request & { requestId: string };

export class RequestIdMiddleware {
  use(
    this: void,
    request: RequestWithId,
    response: Response,
    next: NextFunction,
  ): void {
    const requestId = resolveRequestId(request.get(REQUEST_ID_HEADER));
    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
