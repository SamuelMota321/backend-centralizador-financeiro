import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../../config/environment.schema.js';
import { PluggyApiClient, PluggyUnavailable } from './pluggy-api.client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PluggyApiClient', () => {
  it('classifies completion lookup failures without retaining provider payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        Promise.resolve(
          input.endsWith('/auth')
            ? new Response(JSON.stringify({ apiKey: 'fixture-api-key' }))
            : input.includes('/items/')
              ? new Response('private provider response', { status: 502 })
              : new Response(
                  JSON.stringify({ results: 'private provider response' }),
                ),
        ),
      ),
    );
    const config = {
      get: (key: string) =>
        key === 'PLUGGY_CLIENT_ID' || key === 'PLUGGY_CLIENT_SECRET'
          ? 'fixture-credential'
          : undefined,
    } as unknown as ConfigService<Environment, true>;
    const client = new PluggyApiClient(config);

    await expect(client.getItem('fixture-item')).rejects.toMatchObject({
      operation: 'get_item',
      reason: 'http_status',
      httpStatus: 502,
    });
    await expect(client.listConsents('fixture-item')).rejects.toMatchObject({
      operation: 'list_consents',
      reason: 'invalid_response',
    });
    const error = await client
      .getItem('fixture-item')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PluggyUnavailable);
    expect(JSON.stringify(error)).not.toContain('private provider response');
    expect(JSON.stringify(error)).not.toContain('fixture-credential');
  });

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
      options: {
        clientUserId: 'tenant:user:connection',
        products: [
          'ACCOUNTS',
          'CREDIT_CARDS',
          'TRANSACTIONS',
          'INVESTMENTS',
          'INVESTMENTS_TRANSACTIONS',
        ],
      },
    });
    expect(requests[1]?.init?.headers).toMatchObject({
      'X-API-KEY': 'fixture-api-key',
    });
    expect(JSON.stringify(token)).not.toContain('fixture-api-key');
    expect(JSON.stringify(token)).not.toContain('fixture-client-secret');
  });

  it('scopes an update token to the existing Item and accepts absent investment fields', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        requests.push({
          url: input,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
        if (input.endsWith('/auth'))
          return Promise.resolve(
            new Response(JSON.stringify({ apiKey: 'fixture-api-key' })),
          );
        if (input.endsWith('/connect_token'))
          return Promise.resolve(
            new Response(
              JSON.stringify({ accessToken: 'fixture-connect-token' }),
            ),
          );
        if (input.includes('/investments?'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totalPages: 1,
                results: [
                  {
                    id: '364aa078-983d-4f3d-a28e-fb5575ddc3ee',
                    name: 'Ativo sintético',
                    type: 'ETF',
                    status: 'ACTIVE',
                    fixedAnnualRate: 10.5,
                    balance: 118.4,
                    dueDate: null,
                  },
                ],
              }),
            ),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              totalPages: 1,
              results: [
                {
                  id: '464aa078-983d-4f3d-a28e-fb5575ddc3ee',
                  type: 'BUY',
                  amount: null,
                  date: '2026-10-12T11:22:12.855Z',
                },
              ],
            }),
          ),
        );
      }),
    );
    const config = {
      get: (key: string) =>
        key === 'PLUGGY_CLIENT_ID'
          ? 'fixture-client-id'
          : key === 'PLUGGY_CLIENT_SECRET'
            ? 'fixture-client-secret'
            : undefined,
    } as unknown as ConfigService<Environment, true>;
    const client = new PluggyApiClient(config);
    await client.createConnectToken(
      'tenant:user:connection',
      'f5bf5605-0eba-4a11-9956-088c49068b0b',
    );
    expect(requests[1]?.body).toEqual({
      itemId: 'f5bf5605-0eba-4a11-9956-088c49068b0b',
      options: { clientUserId: 'tenant:user:connection' },
    });
    const investments = await client.listInvestments(
      'f5bf5605-0eba-4a11-9956-088c49068b0b',
      1,
    );
    expect(investments.investments[0]).toMatchObject({
      currencyCode: null,
      maturityDate: null,
      balance: '118.4',
      status: 'ACTIVE',
      fixedAnnualRate: '10.5',
    });
    const movements = await client.listInvestmentMovements(
      '364aa078-983d-4f3d-a28e-fb5575ddc3ee',
      1,
    );
    expect(movements.movements[0]).toMatchObject({
      type: 'BUY',
      amount: null,
    });
  });
});

function parseBody(body: RequestInit['body'] | undefined): unknown {
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.');
  return JSON.parse(body);
}
