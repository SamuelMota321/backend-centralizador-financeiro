import { Logger, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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
});
