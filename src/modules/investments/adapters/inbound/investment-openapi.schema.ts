import type { SchemaObject } from '@nestjs/swagger';

const nullableString = { type: 'string', nullable: true } as const;
const nullableAmount = {
  type: 'string',
  nullable: true,
  pattern: '^-?\\d+(?:\\.\\d+)?$',
} as const;
const page = {
  page: { type: 'integer', minimum: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100 },
  total: { type: 'integer', minimum: 0 },
};
const allocationMember: SchemaObject = {
  type: 'object',
  required: ['id', 'source', 'referenceDate'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    source: { type: 'string', enum: ['pluggy'] },
    referenceDate: { type: 'string', format: 'date-time', nullable: true },
  },
};
const allocationGroup: Record<string, SchemaObject> = {
  amount: {
    type: 'string',
    description: 'Exact summed balance in this currency',
  },
  percentage: {
    type: 'string',
    pattern: '^\\d+\\.\\d$',
    description:
      'Percentage rounded half-up to one decimal; rows are not adjusted to sum to 100.0',
  },
  positions: { type: 'array', items: allocationMember },
};

export const INVESTMENT_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['portfolio', 'positions', 'page', 'pageSize', 'total'],
  properties: {
    portfolio: {
      type: 'object',
      required: [
        'availability',
        'total',
        'totalsByCurrency',
        'referenceDate',
        'connections',
        'allocation',
      ],
      properties: {
        availability: {
          type: 'string',
          enum: ['complete', 'partial', 'unavailable'],
        },
        total: {
          type: 'object',
          nullable: true,
          required: ['currencyCode', 'amount'],
          properties: {
            currencyCode: { type: 'string' },
            amount: { type: 'string' },
          },
        },
        totalsByCurrency: {
          type: 'array',
          items: {
            type: 'object',
            required: ['currencyCode', 'amount'],
            properties: {
              currencyCode: { type: 'string' },
              amount: { type: 'string' },
            },
          },
        },
        referenceDate: { type: 'string', format: 'date-time', nullable: true },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['connectionId', 'availability'],
            properties: {
              connectionId: { type: 'string', format: 'uuid' },
              availability: {
                type: 'string',
                enum: ['complete', 'partial', 'unavailable'],
              },
            },
          },
        },
        allocation: {
          type: 'object',
          required: [
            'basis',
            'availability',
            'knownPositionCount',
            'includedPositionCount',
            'excludedKnownPositionCount',
            'excludedByReason',
            'currencies',
          ],
          properties: {
            basis: {
              type: 'string',
              enum: ['active_current_complete_positive_balance'],
              description:
                'Only ACTIVE positions with positive net balance, known currency, complete collection and current reference are included',
            },
            availability: {
              type: 'string',
              enum: ['complete', 'partial', 'unavailable'],
              description:
                'Partial when known positions are excluded or any connection is incomplete; unavailable without a positive denominator',
            },
            knownPositionCount: { type: 'integer', minimum: 0 },
            includedPositionCount: { type: 'integer', minimum: 0 },
            excludedKnownPositionCount: { type: 'integer', minimum: 0 },
            excludedByReason: {
              type: 'object',
              description:
                'Exclusive counts by first applicable reason: quality, status, balance, currency. Unknown positions at unavailable connections are not counted.',
              required: [
                'incomplete_or_stale',
                'non_active',
                'non_positive_balance',
                'unknown_currency',
              ],
              properties: {
                incomplete_or_stale: { type: 'integer', minimum: 0 },
                non_active: { type: 'integer', minimum: 0 },
                non_positive_balance: { type: 'integer', minimum: 0 },
                unknown_currency: { type: 'integer', minimum: 0 },
              },
            },
            currencies: {
              type: 'array',
              description:
                'Independent denominators per currency; no conversion or cross-currency total',
              items: {
                type: 'object',
                required: [
                  'currencyCode',
                  'denominatorAmount',
                  'byClass',
                  'byInstitution',
                ],
                properties: {
                  currencyCode: { type: 'string' },
                  denominatorAmount: { type: 'string' },
                  byClass: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: [
                        'assetClass',
                        'amount',
                        'percentage',
                        'positions',
                      ],
                      properties: {
                        assetClass: {
                          type: 'string',
                          enum: [
                            'FIXED_INCOME',
                            'EQUITY',
                            'ETF',
                            'MUTUAL_FUND',
                            'COE',
                            'SECURITY',
                            'UNCLASSIFIED',
                          ],
                          description:
                            'OTHER and unsupported provider types are UNCLASSIFIED; subtype is never used to infer a class',
                        },
                        ...allocationGroup,
                      },
                    },
                  },
                  byInstitution: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: [
                        'institutionName',
                        'amount',
                        'percentage',
                        'positions',
                      ],
                      properties: {
                        institutionName: {
                          type: 'string',
                          nullable: true,
                          description:
                            'Null means institution not supplied; known names are grouped exactly as received',
                        },
                        ...allocationGroup,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    positions: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'connectionId',
          'source',
          'externalId',
          'name',
          'assetType',
          'subtype',
          'providerStatus',
          'currencyCode',
          'balance',
          'quantity',
          'investedAmount',
          'resultAmount',
          'institutionName',
          'referenceDate',
          'rate',
          'rateType',
          'fixedAnnualRate',
          'maturityDate',
          'dataQuality',
          'missingFields',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          connectionId: { type: 'string', format: 'uuid' },
          source: { type: 'string', enum: ['pluggy'] },
          externalId: { type: 'string' },
          name: { type: 'string' },
          assetType: { type: 'string' },
          subtype: nullableString,
          providerStatus: nullableString,
          currencyCode: nullableString,
          balance: { type: 'string' },
          quantity: nullableAmount,
          investedAmount: nullableAmount,
          resultAmount: nullableAmount,
          institutionName: nullableString,
          referenceDate: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
          rate: nullableAmount,
          rateType: nullableString,
          fixedAnnualRate: nullableAmount,
          maturityDate: { type: 'string', format: 'date', nullable: true },
          dataQuality: {
            type: 'object',
            required: ['availability', 'freshness'],
            properties: {
              availability: {
                type: 'string',
                enum: ['complete', 'partial', 'unavailable'],
              },
              freshness: {
                type: 'string',
                enum: ['current', 'stale', 'unknown'],
              },
            },
          },
          missingFields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    ...page,
  },
};

export const INVESTMENT_MOVEMENTS_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'positionId',
    'availability',
    'movements',
    'page',
    'pageSize',
    'total',
  ],
  properties: {
    positionId: { type: 'string', format: 'uuid' },
    availability: { type: 'string', enum: ['complete', 'unavailable'] },
    movements: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'source',
          'externalId',
          'type',
          'amount',
          'currencyCode',
          'occurredAt',
          'missingFields',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          source: { type: 'string', enum: ['pluggy'] },
          externalId: { type: 'string' },
          type: { type: 'string' },
          amount: nullableAmount,
          currencyCode: nullableString,
          occurredAt: { type: 'string', format: 'date-time' },
          missingFields: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    ...page,
  },
};

export const INVESTMENT_PROBLEM_RESPONSE = {
  content: {
    'application/problem+json': {
      schema: {
        type: 'object',
        required: ['type', 'title', 'status', 'code', 'detail'],
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'integer' },
          code: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
};
