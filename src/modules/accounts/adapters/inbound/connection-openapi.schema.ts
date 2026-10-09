import type { SchemaObject } from '@nestjs/swagger';

export const CONNECTION_VIEW_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'provider', 'status', 'consent', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider: { type: 'string', enum: ['pluggy'] },
    status: {
      type: 'string',
      enum: [
        'pending_authorization',
        'connected',
        'partially_available',
        'expired',
        'revoked',
        'disconnected',
      ],
    },
    consent: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'status',
        'products',
        'openFinancePermissionsGranted',
        'grantedAt',
        'expiresAt',
        'revokedAt',
      ],
      properties: {
        id: { type: 'string', format: 'uuid', nullable: true },
        status: {
          type: 'string',
          enum: ['granted', 'expired', 'revoked'],
          nullable: true,
        },
        products: { type: 'array', items: { type: 'string' } },
        openFinancePermissionsGranted: {
          type: 'array',
          items: { type: 'string' },
        },
        grantedAt: { type: 'string', format: 'date-time', nullable: true },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        revokedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const CONNECTION_SESSION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['connection', 'connectToken', 'expiresAt'],
  properties: {
    connection: CONNECTION_VIEW_SCHEMA,
    connectToken: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

export const CONNECTION_COMPLETION_REQUEST_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['itemId'],
  properties: { itemId: { type: 'string', format: 'uuid' } },
};

export const PLUGGY_WEBHOOK_REQUEST_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: true,
  required: ['event', 'eventId', 'itemId', 'clientUserId'],
  properties: {
    event: { type: 'string', pattern: '^item/' },
    eventId: { type: 'string', format: 'uuid' },
    itemId: { type: 'string', format: 'uuid' },
    clientUserId: { type: 'string' },
  },
};

export const PLUGGY_WEBHOOK_ACCEPTED_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted'],
  properties: { accepted: { type: 'boolean', enum: [true] } },
};
