import { Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluggyUnavailable } from '../outbound/pluggy-api.client.js';
import { QStashUnavailable } from '../outbound/qstash-pluggy-webhook.service.js';
import { ConnectionsProblemDetailsFilter } from './connections-problem-details.filter.js';

afterEach(() => vi.restoreAllMocks());

describe('ConnectionsProblemDetailsFilter diagnostics', () => {
  it('keeps integration details in safe technical logs and returns generic 503 responses', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const response = {
      status: vi.fn().mockReturnThis(),
      type: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new ConnectionsProblemDetailsFilter();

    const pluggy = new PluggyUnavailable('get_item', 'http_status', 502);
    pluggy.message = 'secret token and financial payload';
    filter.catch(pluggy, host);
    expect(response.status).toHaveBeenLastCalledWith(503);
    expect(response.json).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'INTEGRATION_UNAVAILABLE' }),
    );
    expect(warn).toHaveBeenLastCalledWith(
      JSON.stringify({
        integration: 'pluggy',
        operation: 'get_item',
        reason: 'http_status',
        httpStatus: 502,
      }),
    );

    const schemaError = new PluggyUnavailable(
      'list_consents',
      'schema_mismatch',
      undefined,
      [{ path: 'results.0.products', code: 'invalid_type' }],
    );
    schemaError.message = 'secret consent payload';
    filter.catch(schemaError, host);
    expect(warn).toHaveBeenLastCalledWith(
      JSON.stringify({
        integration: 'pluggy',
        operation: 'list_consents',
        reason: 'schema_mismatch',
        validationIssues: [
          { path: 'results.0.products', code: 'invalid_type' },
        ],
      }),
    );

    const qstash = new QStashUnavailable('publish_sync', 'publish_failed');
    qstash.message = 'secret queue response';
    filter.catch(qstash, host);
    expect(warn).toHaveBeenLastCalledWith(
      JSON.stringify({
        integration: 'qstash',
        operation: 'publish_sync',
        reason: 'publish_failed',
      }),
    );
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });
});
