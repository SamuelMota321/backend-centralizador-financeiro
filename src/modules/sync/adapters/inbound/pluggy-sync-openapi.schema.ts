import type { SchemaObject } from '@nestjs/swagger';

export const SYNC_RUN_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'runId',
    'connectionId',
    'status',
    'trigger',
    'acceptedAt',
    'startedAt',
    'completedAt',
    'referenceDate',
    'reasons',
    'statusUrl',
  ],
  properties: {
    runId: { type: 'string', format: 'uuid' },
    connectionId: { type: 'string', format: 'uuid' },
    status: {
      type: 'string',
      enum: [
        'queued',
        'running',
        'action_required',
        'succeeded',
        'partial',
        'failed',
      ],
    },
    trigger: { type: 'string', enum: ['manual', 'daily'] },
    acceptedAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    referenceDate: { type: 'string', format: 'date-time', nullable: true },
    reasons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['dataType', 'code'],
        properties: {
          dataType: {
            type: 'string',
            enum: [
              'accounts',
              'transactions',
              'investments',
              'investment_transactions',
              'connection',
            ],
          },
          code: {
            type: 'string',
            enum: ['unavailable', 'failed', 'ambiguous_identity'],
          },
        },
      },
    },
    statusUrl: { type: 'string' },
  },
};

export const SYNC_LATEST_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['latest', 'lastReconciled'],
  properties: {
    latest: { ...SYNC_RUN_SCHEMA, nullable: true },
    lastReconciled: { ...SYNC_RUN_SCHEMA, nullable: true },
  },
};

export const UPDATE_SESSION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['connectToken', 'expiresAt'],
  properties: {
    connectToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};
