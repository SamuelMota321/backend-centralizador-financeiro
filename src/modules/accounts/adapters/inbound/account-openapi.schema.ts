import type { SchemaObject } from '@nestjs/swagger';

const ACCOUNT_TYPE_VALUES = [
  'checking',
  'savings',
  'payment',
  'cash',
  'credit_card',
  'investment',
  'other',
];

export const ACCOUNT_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'name',
    'type',
    'origin',
    'institutionName',
    'initialBalance',
    'initialBalanceAsOf',
    'currencyCode',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    type: { type: 'string', enum: ACCOUNT_TYPE_VALUES },
    origin: { type: 'string', enum: ['manual', 'connected'] },
    institutionName: { type: 'string', nullable: true },
    initialBalance: { type: 'string', pattern: '^-?(?:0|[1-9]\\d*)\\.\\d{2}$' },
    initialBalanceAsOf: { type: 'string', format: 'date' },
    currencyCode: { type: 'string', enum: ['BRL'] },
    archivedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const CREATE_ACCOUNT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'initialBalance', 'initialBalanceAsOf'],
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ACCOUNT_TYPE_VALUES },
    institutionName: { type: 'string', nullable: true },
    initialBalance: { type: 'string', example: '1500.00' },
    initialBalanceAsOf: { type: 'string', format: 'date' },
    confirmPossibleDuplicate: { type: 'boolean', default: false },
  },
};

export const UPDATE_ACCOUNT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: ACCOUNT_TYPE_VALUES },
    institutionName: { type: 'string', nullable: true },
    initialBalance: { type: 'string', example: '1250.00' },
    initialBalanceAsOf: { type: 'string', format: 'date' },
    confirmPossibleDuplicate: { type: 'boolean', default: false },
  },
};

export const REQUEST_ID_RESPONSE_HEADERS = {
  'X-Request-Id': {
    description: 'Canonical request correlation identifier.',
    schema: { type: 'string', format: 'uuid' },
  },
};

export const ACCOUNT_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: ACCOUNT_SCHEMA },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
};

export const PROBLEM_DETAILS_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['type', 'title', 'status', 'code', 'detail'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'code', 'message'],
        properties: {
          path: { type: 'string' },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'type', 'origin', 'institutionName'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string', enum: ACCOUNT_TYPE_VALUES },
          origin: { type: 'string', enum: ['connected'] },
          institutionName: { type: 'string', nullable: true },
        },
      },
    },
  },
};

export const PROBLEM_DETAILS_RESPONSE = {
  content: {
    'application/problem+json': {
      schema: PROBLEM_DETAILS_SCHEMA,
    },
  },
  headers: REQUEST_ID_RESPONSE_HEADERS,
};
