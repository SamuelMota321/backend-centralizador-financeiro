import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../../config/environment.schema.js';
import { PluggyApiClient } from './pluggy-api.client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PluggyApiClient', () => {
  it('keeps application credentials server-side and returns only a short-lived Connect Token', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock = vi.fn(
      (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push({ url, init });
        if (url.endsWith('/auth')) {
          return Promise.resolve(
            new Response(JSON.stringify({ apiKey: 'fixture-api-key' }), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({ accessToken: 'fixture-connect-token' }),
            { status: 200 },
          ),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      get: (key: string) =>
        key === 'PLUGGY_CLIENT_ID'
          ? 'fixture-client-id'
          : key === 'PLUGGY_CLIENT_SECRET'
            ? 'fixture-client-secret'
            : undefined,
    } as unknown as ConfigService<Environment, true>;
    const client = new PluggyApiClient(config);

    const token = await client.createConnectToken('tenant:user:connection');

    expect(token.accessToken).toBe('fixture-connect-token');
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe('https://api.pluggy.ai/auth');
    expect(parseBody(requests[0]?.init?.body)).toEqual({
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
    });
    expect(requests[1]?.url).toBe('https://api.pluggy.ai/connect_token');
    expect(parseBody(requests[1]?.init?.body)).toEqual({
      options: { clientUserId: 'tenant:user:connection' },
    });
    expect(requests[1]?.init?.headers).toMatchObject({
      'X-API-KEY': 'fixture-api-key',
    });
    expect(JSON.stringify(token)).not.toContain('fixture-api-key');
    expect(JSON.stringify(token)).not.toContain('fixture-client-secret');
  });
});

function parseBody(body: RequestInit['body'] | undefined): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.');
  return JSON.parse(body);
}
