import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type OpenApiSchema = {
  required?: string[];
  minProperties?: number;
  maximum?: number;
  minimum?: number;
  enum?: string[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
};

type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name?: string; required?: boolean }>;
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiPath = Record<string, OpenApiOperation>;

type OpenApiDocument = {
  paths?: Record<string, OpenApiPath>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

const PROBLEM_DETAILS_FIELDS = ['type', 'title', 'status', 'code', 'detail'];

describe('OpenAPI contract', () => {
  const document = JSON.parse(
    readFileSync(resolve('openapi/openapi.json'), 'utf8'),
  ) as OpenApiDocument;

  it('publishes authenticated investment portfolio and movement reads', () => {
    for (const path of [
      '/api/v1/investments',
      '/api/v1/investments/{id}/movements',
    ]) {
      const operation = document.paths?.[path]?.get;
      expect(operation, path).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);
      expect(operation?.responses).toHaveProperty('200');
      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (/^[45]\d\d$/.test(status))
          expect(response.content).toHaveProperty('application/problem+json');
      }
    }
    const portfolio =
      document.paths?.['/api/v1/investments']?.get?.responses?.['200']
        ?.content?.['application/json']?.schema;
    expect(portfolio?.required).toEqual(
      expect.arrayContaining(['portfolio', 'positions', 'total']),
    );
    expect(portfolio?.properties).toHaveProperty('portfolio');
    expect(portfolio?.properties).toHaveProperty('positions');
    const allocation = portfolio?.properties?.portfolio?.properties?.allocation;
    expect(allocation?.required).toEqual(
      expect.arrayContaining([
        'basis',
        'availability',
        'knownPositionCount',
        'includedPositionCount',
        'excludedKnownPositionCount',
        'excludedByReason',
        'currencies',
      ]),
    );
    const currency = allocation?.properties?.currencies?.items;
    expect(currency?.required).toEqual(
      expect.arrayContaining([
        'currencyCode',
        'denominatorAmount',
        'byClass',
        'byInstitution',
      ]),
    );
    expect(
      currency?.properties?.byClass?.items?.properties?.assetClass?.enum,
    ).toContain('UNCLASSIFIED');
    expect(currency?.properties?.byClass?.items?.properties).toHaveProperty(
      'positions',
    );
  });

  it('publishes authenticated manual patrimony CRUD and history', () => {
    const operations: Array<[string, string, string]> = [
      ['/api/v1/patrimony/{collection}', 'post', '201'],
      ['/api/v1/patrimony/{collection}', 'get', '200'],
      ['/api/v1/patrimony/{collection}/{id}', 'get', '200'],
      ['/api/v1/patrimony/{collection}/{id}', 'patch', '200'],
      ['/api/v1/patrimony/{collection}/{id}/history', 'get', '200'],
    ];
    for (const [path, method, success] of operations) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);
      expect(operation?.responses).toHaveProperty(success);
      expect(
        operation?.parameters?.find(
          (parameter) => parameter.name === 'collection',
        ),
      ).toMatchObject({ required: true });
      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (/^[45]\d\d$/.test(status))
          expect(response.content).toHaveProperty('application/problem+json');
      }
    }
  });

  it('documents authentication and Problem Details for account operations', () => {
    const operations: Array<[string, string]> = [
      ['/api/v1/accounts', 'post'],
      ['/api/v1/accounts', 'get'],
      ['/api/v1/accounts/{accountId}', 'patch'],
      ['/api/v1/accounts/{accountId}/deactivate', 'post'],
    ];

    for (const [path, method] of operations) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);

      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (!/^[45]\d\d$/.test(status)) continue;
        expect(
          response.content,
          `${method.toUpperCase()} ${path} ${status}`,
        ).toHaveProperty('application/problem+json');
        expect(response.content).not.toHaveProperty('application/json');
        expect(
          response.content?.['application/problem+json']?.schema?.required,
        ).toEqual(expect.arrayContaining(PROBLEM_DETAILS_FIELDS));
      }
    }
  });

  it('documents the authenticated Pluggy connection lifecycle and public webhook', () => {
    const authenticatedOperations: Array<[string, string, string]> = [
      ['/api/v1/connections/pluggy/sessions', 'post', '201'],
      ['/api/v1/connections/pluggy/completions', 'post', '202'],
      ['/api/v1/connections/{connectionId}', 'get', '200'],
      ['/api/v1/connections/{connectionId}/disconnect', 'post', '200'],
      [
        '/api/v1/connections/{connectionId}/accounts/{providerAccountId}/mapping',
        'put',
        '200',
      ],
    ];

    for (const [path, method, successStatus] of authenticatedOperations) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);
      expect(operation?.responses).toHaveProperty(successStatus);
      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (!/^[45]\d\d$/.test(status)) continue;
        expect(response.content).toHaveProperty('application/problem+json');
      }
    }

    const sessionSchema =
      document.paths?.['/api/v1/connections/pluggy/sessions']?.post
        ?.responses?.['201']?.content?.['application/json']?.schema;
    expect(Object.keys(sessionSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(['connection', 'connectToken', 'expiresAt']),
    );
    expect(sessionSchema?.properties).not.toHaveProperty('clientId');
    expect(sessionSchema?.properties).not.toHaveProperty('clientSecret');
    expect(sessionSchema?.properties).not.toHaveProperty('apiKey');

    const completion =
      document.paths?.['/api/v1/connections/pluggy/completions']?.post;
    expect(completion?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(
      completion?.responses?.['202']?.content?.['application/json']?.schema
        ?.required,
    ).toEqual(expect.arrayContaining(['connection', 'initialImport']));

    const webhook = document.paths?.['/api/v1/webhooks/pluggy']?.post;
    expect(webhook?.responses).toHaveProperty('202');
    expect(webhook?.security).toBeUndefined();
    expect(document.paths).not.toHaveProperty(
      '/api/v1/internal/jobs/pluggy-events',
    );
  });

  it('documents HU-008 manual, status and Item update routes', () => {
    const operations: Array<[string, string, string]> = [
      ['/api/v1/connections/{connectionId}/sync-runs', 'post', '202'],
      ['/api/v1/connections/{connectionId}/sync-runs/latest', 'get', '200'],
      ['/api/v1/connections/{connectionId}/sync-runs/{runId}', 'get', '200'],
      ['/api/v1/connections/{connectionId}/update-session', 'post', '200'],
    ];
    for (const [path, method, status] of operations) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);
      expect(operation?.responses).toHaveProperty(status);
      for (const [errorStatus, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (/^[45]\d\d$/.test(errorStatus))
          expect(response.content).toHaveProperty('application/problem+json');
      }
    }
    const run =
      document.paths?.[operations[0]![0]]?.post?.responses?.['202']?.content?.[
        'application/json'
      ]?.schema;
    expect(run?.required).toEqual(
      expect.arrayContaining(['runId', 'status', 'reasons', 'statusUrl']),
    );
    expect(run?.properties).not.toHaveProperty('connectToken');
  });

  it('does not expose hard-delete for accounts', () => {
    expect(document.paths?.['/api/v1/accounts/{accountId}']).not.toHaveProperty(
      'delete',
    );
  });

  it('publishes Transactions movement routes and foundation schemas', () => {
    const schemas = document.components?.schemas;
    for (const schemaName of [
      'TransactionView',
      'CreateTransaction',
      'TransferView',
      'CreateTransfer',
      'CategoryView',
      'CreateCategory',
      'UpdateCategory',
      'CategoryRuleView',
      'CreateCategoryRule',
      'UpdateCategoryRule',
      'UpdateTransactionCategory',
      'TransactionPage',
      'CategoryPage',
      'CategoryRulePage',
    ]) {
      expect(schemas, schemaName).toHaveProperty(schemaName);
    }
    const operations: Array<[string, string, string]> = [
      ['/api/v1/transactions', 'post', '201'],
      ['/api/v1/transactions', 'get', '200'],
      ['/api/v1/transactions/{transactionId}/category', 'patch', '200'],
      ['/api/v1/transfers', 'post', '201'],
      ['/api/v1/categories', 'get', '200'],
      ['/api/v1/categories', 'post', '201'],
      ['/api/v1/categories/{categoryId}', 'patch', '200'],
      ['/api/v1/categories/{categoryId}/deactivate', 'post', '200'],
      ['/api/v1/category-rules', 'get', '200'],
      ['/api/v1/category-rules', 'post', '201'],
      ['/api/v1/category-rules/{ruleId}', 'patch', '200'],
      ['/api/v1/category-rules/{ruleId}/activate', 'post', '200'],
      ['/api/v1/category-rules/{ruleId}/deactivate', 'post', '200'],
      ['/api/v1/category-rules/{ruleId}', 'delete', '200'],
    ];
    for (const [path, method, successStatus] of operations) {
      const operation = document.paths?.[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation?.security).toEqual([{ auth0: [] }]);
      expect(operation?.responses).toHaveProperty(successStatus);
      for (const [status, response] of Object.entries(
        operation?.responses ?? {},
      )) {
        if (!/^[45]\d\d$/.test(status)) continue;
        expect(response.content).toHaveProperty('application/problem+json');
      }
    }
  });

  it('publishes the category rule priority ceiling and fixed delete response', () => {
    const schemas = document.components?.schemas;
    for (const schemaName of [
      'CategoryRuleView',
      'CreateCategoryRule',
      'UpdateCategoryRule',
    ]) {
      expect(
        schemas?.[schemaName]?.properties?.priority?.maximum,
        `${schemaName}.priority.maximum`,
      ).toBe(2_147_483_647);
    }

    const deleteOperation =
      document.paths?.['/api/v1/category-rules/{ruleId}']?.delete;
    expect(deleteOperation?.responses).toHaveProperty('200');
    expect(deleteOperation?.responses).not.toHaveProperty('204');
  });
});
