import { Logger, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodError, z } from 'zod';
import { CategoryNameConflict } from '../../application/transactions.errors.js';
import { TransactionsProblemDetailsFilter } from './transactions-problem-details.filter.js';

describe('TransactionsProblemDetailsFilter', () => {
  it('keeps sensitive exception messages out of technical logs and responses', () => {
    const sensitiveMessage = 'access_token=fictional amount=987654.32';
    const errorLogger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;

    try {
      new TransactionsProblemDetailsFilter().catch(
        new Error(sensitiveMessage),
        host,
      );

      expect(errorLogger).toHaveBeenCalledOnce();
      expect(String(errorLogger.mock.calls[0]?.[0])).not.toContain(
        sensitiveMessage,
      );
      expect(response.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ detail: sensitiveMessage }),
      );
    } finally {
      errorLogger.mockRestore();
    }
  });

  it('publishes the category conflict and empty patch contract', () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new TransactionsProblemDetailsFilter();

    filter.catch(new CategoryNameConflict(), host);
    expect(response.status).toHaveBeenLastCalledWith(409);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'CATEGORY_ALREADY_EXISTS', status: 409 }),
    );

    const emptyPatch = z.object({}).refine(() => false, {
      message: 'EMPTY_PATCH',
    });
    const parsed = emptyPatch.safeParse({});
    if (parsed.success) throw new Error('Expected an empty patch error.');
    filter.catch(new ZodError(parsed.error.issues), host);
    expect(response.status).toHaveBeenLastCalledWith(400);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({
        code: 'INVALID_REQUEST',
        errors: [expect.objectContaining({ code: 'EMPTY_PATCH', path: '$' })],
      }),
    );
  });
});
