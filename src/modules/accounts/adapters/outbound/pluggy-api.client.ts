import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../../../../config/environment.schema.js';
import type {
  PluggyConnectToken,
  PluggyAccountSnapshot,
  PluggyAccountsPage,
  PluggyConsentSnapshot,
  PluggyItemSnapshot,
  PluggyProvider,
  PluggyTransactionsPage,
  PluggyInvestmentsPage,
  PluggyInvestmentMovementsPage,
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
  products: z.array(z.string()).optional(),
  statusDetail: z.unknown().optional(),
  lastUpdatedAt: z.iso.datetime().nullable().optional(),
  userAction: z
    .object({ type: z.string() })
    .passthrough()
    .nullable()
    .optional(),
});
const consentResponseSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  products: z.array(z.string()),
  openFinancePermissionsGranted: z
    .array(z.string())
    .nullish()
    .transform((permissions) => permissions ?? []),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable().optional(),
  revokedAt: z.iso.datetime().nullable().optional(),
});
const consentsResponseSchema = z.object({
  results: z.array(consentResponseSchema),
});
const accountResponseSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  subtype: z.string().min(1),
  name: z.string().min(1),
  balance: z.number().finite(),
  currencyCode: z.string().length(3),
});
const accountsResponseSchema = z.object({
  page: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  results: z.array(accountResponseSchema),
});
const transactionResponseSchema = z.object({
  id: z.string().uuid().nullish(),
  accountId: z.string().uuid(),
  amount: z.number().finite(),
  date: z.iso.datetime(),
  description: z.string().nullable().optional(),
  type: z.enum(['CREDIT', 'DEBIT']),
  status: z.string().min(1),
  currencyCode: z.string().length(3),
});
const transactionsResponseSchema = z.object({
  results: z.array(transactionResponseSchema),
  next: z.string().nullable(),
});
const investmentResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1).nullish(),
  subtype: z.string().nullish(),
  balance: z.number().finite(),
  currencyCode: z.string().length(3).nullish(),
  quantity: z.number().finite().nullish(),
  amount: z.number().finite().nullish(),
  amountOriginal: z.number().finite().nullish(),
  amountProfit: z.number().finite().nullish(),
  institution: z.object({ name: z.string().nullish() }).nullish(),
  rate: z.number().finite().nullish(),
  rateType: z.string().nullish(),
  fixedAnnualRate: z.number().finite().nullish(),
  dueDate: z.iso.datetime().nullish(),
  date: z.iso.datetime().nullish(),
});
const investmentsResponseSchema = z.object({
  totalPages: z.number().int().nonnegative(),
  results: z.array(investmentResponseSchema),
});
const investmentMovementResponseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  amount: z.number().finite().nullish(),
  date: z.iso.datetime(),
});
const investmentMovementsResponseSchema = z.object({
  totalPages: z.number().int().nonnegative(),
  results: z.array(investmentMovementResponseSchema),
});

export class PluggyUnavailable extends Error {
  override readonly name = 'PluggyUnavailable';

  constructor(
    readonly operation:
      'authenticate' | 'get_item' | 'list_consents' | 'other' = 'other',
    readonly reason:
      | 'missing_config'
      | 'network'
      | 'http_status'
      | 'invalid_response'
      | 'invalid_json'
      | 'schema_mismatch'
      | 'unknown' = 'unknown',
    readonly httpStatus?: number,
    readonly validationIssues?: readonly Readonly<{
      path: string;
      code: string;
    }>[],
  ) {
    super();
  }
}

export class PluggyActionRequired extends Error {
  override readonly name = 'PluggyActionRequired';
}

export class PluggyUpdateDeferred extends Error {
  override readonly name = 'PluggyUpdateDeferred';
}

type ApiKeyCache = Readonly<{ value: string; expiresAt: number }>;

@Injectable()
export class PluggyApiClient implements PluggyProvider {
  private apiKeyCache: ApiKeyCache | null = null;
  private apiKeyRequest: Promise<ApiKeyCache> | null = null;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async createConnectToken(
    clientUserId: string,
    itemId?: string,
  ): Promise<PluggyConnectToken> {
    const requestStartedAt = Date.now();
    const body = await this.request('/connect_token', {
      method: 'POST',
      body: JSON.stringify({
        ...(itemId ? { itemId } : {}),
        options: {
          clientUserId,
          ...(!itemId
            ? {
                products: [
                  'ACCOUNTS',
                  'CREDIT_CARDS',
                  'TRANSACTIONS',
                  'INVESTMENTS',
                  'INVESTMENTS_TRANSACTIONS',
                ],
              }
            : {}),
        },
      }),
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
      {},
      'get_item',
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new PluggyUnavailable('get_item', 'http_status', response.status);

    const parsed = itemResponseSchema.safeParse(
      await readJson(response, 'get_item'),
    );
    if (!parsed.success)
      throw new PluggyUnavailable('get_item', 'invalid_response');
    return {
      ...parsed.data,
      unavailableProducts: unavailableProducts(parsed.data.statusDetail),
      userAction: parsed.data.userAction?.type ?? null,
      lastUpdatedAt: parsed.data.lastUpdatedAt
        ? new Date(parsed.data.lastUpdatedAt)
        : null,
    };
  }

  async updateItem(itemId: string): Promise<PluggyItemSnapshot> {
    const response = await this.requestResponse(
      `/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        body: '{}',
      },
    );
    if (!response.ok) {
      const body = await readJson(response).catch(() => null);
      const code =
        typeof body === 'object' && body !== null && 'codeDescription' in body
          ? String(body.codeDescription)
          : '';
      if (
        code === 'PARAMETERS_NOT_PROVIDED' ||
        code === 'LAST_EXECUTION_HAD_LOGIN_ERROR' ||
        code === 'CONNECTOR_REQUIRED_PARAMETER_VALIDATION_ERROR' ||
        code.includes('MFA') ||
        code.includes('CREDENTIAL')
      ) {
        throw new PluggyActionRequired();
      }
      if (
        code === 'ITEM_ALREADY_UPDATING' ||
        code === 'ITEM_IS_ALREADY_UPDATING'
      ) {
        throw new PluggyUnavailable();
      }
      if (code === 'CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY') {
        throw new PluggyUpdateDeferred();
      }
      throw new PluggyUnavailable();
    }
    const parsed = itemResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      ...parsed.data,
      unavailableProducts: unavailableProducts(parsed.data.statusDetail),
      userAction: parsed.data.userAction?.type ?? null,
      lastUpdatedAt: parsed.data.lastUpdatedAt
        ? new Date(parsed.data.lastUpdatedAt)
        : null,
    };
  }

  async listConsents(
    itemId: string,
  ): Promise<readonly PluggyConsentSnapshot[]> {
    const response = await this.requestResponse(
      `/consents?itemId=${encodeURIComponent(itemId)}`,
      {},
      'list_consents',
    );
    if (!response.ok)
      throw new PluggyUnavailable(
        'list_consents',
        'http_status',
        response.status,
      );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PluggyUnavailable('list_consents', 'invalid_json');
    }
    const parsed = consentsResponseSchema.safeParse(body);
    if (!parsed.success)
      throw new PluggyUnavailable(
        'list_consents',
        'schema_mismatch',
        undefined,
        parsed.error.issues.map(({ path, code }) => ({
          path: path.join('.'),
          code,
        })),
      );
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

  async listAccounts(
    itemId: string,
    page: number,
  ): Promise<PluggyAccountsPage> {
    const query = new URLSearchParams({
      itemId,
      page: String(page),
      pageSize: '500',
    });
    const body = await this.request(`/accounts?${query.toString()}`, {});
    const parsed = accountsResponseSchema.safeParse(body);
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      totalPages: parsed.data.totalPages,
      accounts: parsed.data.results.map(toPluggyAccountSnapshot),
    };
  }

  async listTransactions(
    accountId: string,
    next: string | null,
  ): Promise<PluggyTransactionsPage> {
    const path = next
      ? safeTransactionsNextPath(next)
      : `/v2/transactions?${new URLSearchParams({ accountId }).toString()}`;
    const body = await this.request(path, {});
    const parsed = transactionsResponseSchema.safeParse(body);
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      next: parsed.data.next,
      transactions: parsed.data.results.map((transaction) => ({
        id: transaction.id ?? null,
        accountId: transaction.accountId,
        amount: String(transaction.amount),
        date: transaction.date,
        description: transaction.description ?? null,
        type: transaction.type,
        status: transaction.status,
        currencyCode: transaction.currencyCode,
      })),
    };
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

  async listInvestments(
    itemId: string,
    page: number,
  ): Promise<PluggyInvestmentsPage> {
    const query = new URLSearchParams({
      itemId,
      page: String(page),
      pageSize: '500',
    });
    const body = await this.request(`/investments?${query.toString()}`, {});
    const parsed = investmentsResponseSchema.safeParse(body);
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      totalPages: parsed.data.totalPages,
      investments: parsed.data.results.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        status: row.status ?? null,
        subtype: row.subtype ?? null,
        balance: String(row.balance),
        currencyCode: row.currencyCode ?? null,
        quantity:
          row.quantity === undefined || row.quantity === null
            ? null
            : String(row.quantity),
        amount:
          row.amount === undefined || row.amount === null
            ? null
            : String(row.amount),
        amountOriginal:
          row.amountOriginal === undefined || row.amountOriginal === null
            ? null
            : String(row.amountOriginal),
        amountProfit:
          row.amountProfit === undefined || row.amountProfit === null
            ? null
            : String(row.amountProfit),
        institutionName: row.institution?.name ?? null,
        rate:
          row.rate === undefined || row.rate === null ? null : String(row.rate),
        rateType: row.rateType ?? null,
        fixedAnnualRate:
          row.fixedAnnualRate === undefined || row.fixedAnnualRate === null
            ? null
            : String(row.fixedAnnualRate),
        maturityDate: row.dueDate ?? null,
        date: row.date ?? null,
      })),
    };
  }

  async listInvestmentMovements(
    investmentId: string,
    page: number,
  ): Promise<PluggyInvestmentMovementsPage> {
    const query = new URLSearchParams({ page: String(page), pageSize: '500' });
    const body = await this.request(
      `/investments/${encodeURIComponent(investmentId)}/transactions?${query.toString()}`,
      {},
    );
    const parsed = investmentMovementsResponseSchema.safeParse(body);
    if (!parsed.success) throw new PluggyUnavailable();
    return {
      totalPages: parsed.data.totalPages,
      movements: parsed.data.results.map((row) => ({
        id: row.id,
        type: row.type,
        amount: row.amount == null ? null : String(row.amount),
        date: row.date,
      })),
    };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.requestResponse(path, init);
    if (!response.ok) throw new PluggyUnavailable();
    return readJson(response);
  }

  private async requestResponse(
    path: string,
    init: RequestInit = {},
    operation: PluggyUnavailable['operation'] = 'other',
  ): Promise<Response> {
    const apiKey = await this.getApiKey();
    const response = await this.send(path, init, apiKey.value, operation);
    if (response.status !== 401) return response;

    if (this.apiKeyCache?.value === apiKey.value) this.apiKeyCache = null;
    const refreshedApiKey = await this.getApiKey();
    return this.send(path, init, refreshedApiKey.value, operation);
  }

  private async send(
    path: string,
    init: RequestInit,
    apiKey: string,
    operation: PluggyUnavailable['operation'],
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
      throw new PluggyUnavailable(operation, 'network');
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
    if (!clientId || !clientSecret)
      throw new PluggyUnavailable('authenticate', 'missing_config');

    const requestStartedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${PLUGGY_API_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
    } catch {
      throw new PluggyUnavailable('authenticate', 'network');
    }
    if (!response.ok)
      throw new PluggyUnavailable(
        'authenticate',
        'http_status',
        response.status,
      );

    const parsed = apiKeyResponseSchema.safeParse(
      await readJson(response, 'authenticate'),
    );
    if (!parsed.success)
      throw new PluggyUnavailable('authenticate', 'invalid_response');
    return {
      value: parsed.data.apiKey,
      expiresAt: requestStartedAt + API_KEY_LIFETIME_MS,
    };
  }
}

function unavailableProducts(detail: unknown): string[] {
  if (!detail || typeof detail !== 'object') return [];
  const products = {
    accounts: 'ACCOUNTS',
    creditCards: 'CREDIT_CARDS',
    transactions: 'TRANSACTIONS',
    investments: 'INVESTMENTS',
    investmentsTransactions: 'INVESTMENTS_TRANSACTIONS',
  } as const;
  return Object.entries(products).flatMap(([key, product]) => {
    const value = (detail as Record<string, unknown>)[key];
    return value &&
      typeof value === 'object' &&
      'isUpdated' in value &&
      value.isUpdated === false
      ? [product]
      : [];
  });
}

function toPluggyAccountSnapshot(
  account: z.infer<typeof accountResponseSchema>,
): PluggyAccountSnapshot {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    balance: String(account.balance),
    currencyCode: account.currencyCode,
  };
}

function safeTransactionsNextPath(next: string): string {
  if (!next.startsWith('?')) throw new PluggyUnavailable();
  const parsed = new URL(next, `${PLUGGY_API_URL}/v2/transactions`);
  if (
    parsed.origin !== PLUGGY_API_URL ||
    parsed.pathname !== '/v2/transactions'
  ) {
    throw new PluggyUnavailable();
  }
  return `${parsed.pathname}${parsed.search}`;
}

async function readJson(
  response: Response,
  operation: PluggyUnavailable['operation'] = 'other',
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PluggyUnavailable(operation, 'invalid_response');
  }
}
