import type { SchemaObject } from '@nestjs/swagger';
import { CONNECTION_VIEW_SCHEMA } from '../../../accounts/adapters/inbound/connection-openapi.schema.js';

const INITIAL_IMPORT_VIEW_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'status',
    'availability',
    'accountMapping',
    'transactions',
    'terminalAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: {
      type: 'string',
      enum: [
        'queued',
        'processing',
        'awaiting_account_mapping',
        'completed',
        'completed_with_errors',
        'failed',
      ],
    },
    availability: {
      type: 'object',
      additionalProperties: false,
      required: ['accounts', 'transactions'],
      properties: {
        accounts: { $ref: '#/components/schemas/PluggyDataAvailability' },
        transactions: { $ref: '#/components/schemas/PluggyDataAvailability' },
      },
    },
    accountMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'mapped', 'accounts'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        mapped: { type: 'integer', minimum: 0 },
        accounts: {
          type: 'array',
          items: { $ref: '#/components/schemas/PluggyImportAccount' },
        },
      },
    },
    transactions: {
      type: 'object',
      additionalProperties: false,
      required: ['total', 'imported', 'ignored', 'failed'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        imported: { type: 'integer', minimum: 0 },
        ignored: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
      },
    },
    terminalAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const PLUGGY_INITIAL_IMPORT_SCHEMAS: Record<string, SchemaObject> = {
  PluggyDataAvailability: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'errorCode'],
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'available', 'unavailable', 'failed'],
      },
      errorCode: { type: 'string', nullable: true },
    },
  },
  PluggyImportAccount: {
    type: 'object',
    additionalProperties: false,
    required: [
      'providerAccountId',
      'name',
      'accountType',
      'currencyCode',
      'mappingStatus',
      'errorCode',
      'mappedAccountId',
    ],
    properties: {
      providerAccountId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      accountType: {
        type: 'string',
        enum: ['checking', 'savings', 'credit_card'],
        nullable: true,
      },
      currencyCode: { type: 'string', minLength: 3, maxLength: 3 },
      mappingStatus: {
        type: 'string',
        enum: ['pending', 'mapped', 'unsupported'],
      },
      errorCode: { type: 'string', nullable: true },
      mappedAccountId: { type: 'string', format: 'uuid', nullable: true },
    },
  },
};

export const PLUGGY_COMPLETION_ACCEPTED_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['connection', 'initialImport'],
  properties: {
    connection: CONNECTION_VIEW_SCHEMA,
    initialImport: INITIAL_IMPORT_VIEW_SCHEMA,
  },
};

export const PLUGGY_CONNECTION_IMPORT_VIEW_SCHEMA: SchemaObject = {
  allOf: [
    CONNECTION_VIEW_SCHEMA,
    {
      type: 'object',
      required: ['initialImport'],
      properties: {
        initialImport: { ...INITIAL_IMPORT_VIEW_SCHEMA, nullable: true },
      },
    },
  ],
};

export const PLUGGY_ACCOUNT_MAPPING_REQUEST_SCHEMA: SchemaObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'accountId'],
      properties: {
        action: { type: 'string', enum: ['link'] },
        accountId: { type: 'string', format: 'uuid' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: { action: { type: 'string', enum: ['create'] } },
    },
  ],
};

export const PLUGGY_ACCOUNT_MAPPING_RESPONSE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['connectionId', 'providerAccountId', 'accountId', 'initialImport'],
  properties: {
    connectionId: { type: 'string', format: 'uuid' },
    providerAccountId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    initialImport: INITIAL_IMPORT_VIEW_SCHEMA,
  },
};
