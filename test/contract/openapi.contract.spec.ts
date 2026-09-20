import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type OpenApiSchema = {
  required?: string[];
};

type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiPath = Record<string, OpenApiOperation>;

type OpenApiDocument = {
  paths?: Record<string, OpenApiPath>;
};

const PROBLEM_DETAILS_FIELDS = ['type', 'title', 'status', 'code', 'detail'];

describe('OpenAPI contract', () => {
  const document = JSON.parse(
    readFileSync(resolve('openapi/openapi.json'), 'utf8'),
  ) as OpenApiDocument;

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

  it('does not expose hard-delete for accounts', () => {
    expect(document.paths?.['/api/v1/accounts/{accountId}']).not.toHaveProperty(
      'delete',
    );
  });
});
