import type { SchemaObject } from '@nestjs/swagger';

const problemDetailsSchema: SchemaObject = {
  type: 'object',
  required: ['type', 'title', 'status', 'code', 'detail'],
  properties: {
    type: { type: 'string', example: 'about:blank' },
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
  },
};

const importRunItemSchema: SchemaObject = {
  type: 'object',
  required: [
    'ordinal',
    'externalId',
    'type',
    'amount',
    'occurredOn',
    'description',
    'status',
    'isDuplicate',
    'warnings',
    'errorCode',
  ],
  properties: {
    ordinal: { type: 'integer', minimum: 1 },
    externalId: { type: 'string', nullable: true },
    type: { type: 'string', enum: ['income', 'expense'] },
    amount: { type: 'string', pattern: '^\\d+\\.\\d{2}$' },
    occurredOn: { type: 'string', format: 'date' },
    description: { type: 'string', nullable: true },
    status: {
      type: 'string',
      enum: ['previewed', 'imported', 'ignored_duplicate', 'failed'],
    },
    isDuplicate: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
    errorCode: { type: 'string', nullable: true },
  },
};

export const IMPORT_RUN_RESPONSE_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'destinationAccountId',
    'status',
    'variant',
    'fileSizeBytes',
    'totalItems',
    'importedItems',
    'ignoredItems',
    'failedItems',
    'terminalAt',
    'retentionExpiresAt',
    'createdAt',
    'updatedAt',
    'items',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    destinationAccountId: { type: 'string', format: 'uuid' },
    status: {
      type: 'string',
      enum: [
        'preview_ready',
        'queued',
        'processing',
        'completed',
        'completed_with_errors',
        'failed',
        'expired',
      ],
    },
    variant: { type: 'string', enum: ['ofx_1_sgml', 'ofx_2_xml'] },
    fileSizeBytes: { type: 'integer', minimum: 1, maximum: 10485760 },
    totalItems: { type: 'integer', minimum: 0 },
    importedItems: { type: 'integer', minimum: 0 },
    ignoredItems: { type: 'integer', minimum: 0 },
    failedItems: { type: 'integer', minimum: 0 },
    terminalAt: { type: 'string', format: 'date-time', nullable: true },
    retentionExpiresAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    items: { type: 'array', items: importRunItemSchema },
  },
};

export const INGESTION_PROBLEM_DETAILS_RESPONSE = {
  content: {
    'application/problem+json': { schema: problemDetailsSchema },
  },
};

export const OFX_PREVIEW_REQUEST_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['file', 'destinationAccountId'],
  properties: {
    file: { type: 'string', format: 'binary' },
    destinationAccountId: { type: 'string', format: 'uuid' },
  },
};

export const OFX_CONFIRMATION_REQUEST_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['destinationAccountId'],
  properties: { destinationAccountId: { type: 'string', format: 'uuid' } },
};
