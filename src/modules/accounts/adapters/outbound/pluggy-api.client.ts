import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../../../../config/environment.schema.js';
import type {
  PluggyConnectToken,
  PluggyConsentSnapshot,
  PluggyItemSnapshot,
  PluggyProvider,
} from '../../application/ports/pluggy-provider.port.js';

const PLUGGY_API_URL = 'https://api.pluggy.ai';
const API_KEY_LIFETIME_MS = 2 * 60 * 60 * 1000;
const CONNECT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const API_KEY_REUSE_MARGIN_MS = 60 * 1000;

const apiKeyResponseSchema = z.object({ apiKey: z.string().min(1) });
const connectTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
});
const itemResponseSchema = z.object({
  id: z.string().uuid(),
  clientUserId: z.string().nullable(),
  status: z.string().min(1),
  executionStatus: z.string().min(1),
});
const consentResponseSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  products: z.array(z.string()),
  openFinancePermissionsGranted: z.array(z.string()).optional().default([]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
const consentsResponseSchema = z.object({
  results: z.array(consentResponseSchema),
});

export class PluggyUnavailable extends Error {
  override readonly name = 'PluggyUnavailable';
}

type ApiKeyCache = Readonly<{ value: string; expiresAt: number }>;

@Injectable()
export class PluggyApiClient implements PluggyProvider {
  private apiKeyCache: ApiKeyCache | null = null;
  private apiKeyRequest: Promise<ApiKeyCache> | null = null;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async createConnectToken(clientUserId: string): Promise<PluggyConnectToken> {
    const requestStartedAt = Date.now();
    const body = await this.request('/connect_token', {
      method: 'POST',
      body: JSON.stringify({ options: { clientUserId } }),
    });
    const parsed = connectTokenResponseSchema.safeParse(body);
    if (!parsed.success) throw new PluggyUnavailable();

    // Pluggy documents a fixed 30-minute Connect Token lifetime, not an expiry field.
    return {
      accessToken: parsed.data.accessToken,
      expiresAt: new Date(requestStartedAt + CONNECT_TOKEN_LIFETIME_MS),
    };
  }

  async getItem(itemId: string): Promise<PluggyItemSnapshot | null> {
    const response = await this.requestResponse(
      `/items/${encodeURIComponent(itemId)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new PluggyUnavailable();

    const parsed = itemResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new PluggyUnavailable();
    return parsed.data;
  }

  async listConsents(
    itemId: string,
  ): Promise<readonly PluggyConsentSnapshot[]> {
    const response = await this.requestResponse(
      `/consents?itemId=${encodeURIComponent(itemId)}`,
    );
    if (!response.ok) throw new PluggyUnavailable();

    const parsed = consentsResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new PluggyUnavailable();
    return parsed.data.results.map((consent) => ({
      id: consent.id,
      itemId: consent.itemId,
      products: consent.products,
      openFinancePermissionsGranted: consent.openFinancePermissionsGranted,
      createdAt: new Date(consent.createdAt),
      expiresAt: consent.expiresAt ? new Date(consent.expiresAt) : null,
      revokedAt: consent.revokedAt ? new Date(consent.revokedAt) : null,
    }));
  }

  async deleteItem(itemId: string): Promise<void> {
    const response = await this.requestResponse(
      `/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok && response.status !== 404) {
      throw new PluggyUnavailable();
    }
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.requestResponse(path, init);
    if (!response.ok) throw new PluggyUnavailable();
    return readJson(response);
  }

  private async requestResponse(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const apiKey = await this.getApiKey();
    const response = await this.send(path, init, apiKey.value);
    if (response.status !== 401) return response;

    if (this.apiKeyCache?.value === apiKey.value) this.apiKeyCache = null;
    const refreshedApiKey = await this.getApiKey();
    return this.send(path, init, refreshedApiKey.value);
  }

  private async send(
    path: string,
    init: RequestInit,
    apiKey: string,
  ): Promise<Response> {
    try {
      return await fetch(`${PLUGGY_API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
          ...init.headers,
        },
      });
    } catch {
      throw new PluggyUnavailable();
    }
  }

  private async getApiKey(): Promise<ApiKeyCache> {
    const now = Date.now();
    if (
      this.apiKeyCache &&
      this.apiKeyCache.expiresAt - now > API_KEY_REUSE_MARGIN_MS
    ) {
      return this.apiKeyCache;
    }
    if (this.apiKeyRequest) return this.apiKeyRequest;

    this.apiKeyRequest = this.authenticate();
    try {
      this.apiKeyCache = await this.apiKeyRequest;
      return this.apiKeyCache;
    } finally {
      this.apiKeyRequest = null;
    }
  }

  private async authenticate(): Promise<ApiKeyCache> {
    const clientId = this.config.get('PLUGGY_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('PLUGGY_CLIENT_SECRET', {
      infer: true,
    });
    if (!clientId || !clientSecret) throw new PluggyUnavailable();

    const requestStartedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${PLUGGY_API_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
    } catch {
      throw new PluggyUnavailable();
    }
    if (!response.ok) throw new PluggyUnavailable();

    const parsed = apiKeyResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      value: parsed.data.apiKey,
      expiresAt: requestStartedAt + API_KEY_LIFETIME_MS,
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PluggyUnavailable();
  }
}
