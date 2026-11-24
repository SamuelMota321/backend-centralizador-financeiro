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
