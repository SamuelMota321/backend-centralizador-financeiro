import type { SchemaObject } from '@nestjs/swagger';
import { CATEGORY_RULE_PRIORITY_MAX } from '../../domain/category-rule.js';

const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
const TRANSACTION_STATUSES = ['posted', 'voided'];
const TRANSFER_SIDES = ['outgoing', 'incoming'];
const CATEGORIZATION_STATUSES = [
  'unclassified',
  'categorized',
  'uncertain',
  'unrecognized',
  'not_applicable',
];
const CATEGORIZATION_SOURCES = ['manual', 'rule'];
const RULE_FIELDS = ['description', 'type', 'accountId'];
const RULE_OPERATORS = ['equals', 'contains', 'starts_with', 'ends_with'];
const RULE_STATUSES = ['active', 'inactive', 'removed'];

const UUID_SCHEMA: SchemaObject = { type: 'string', format: 'uuid' };
const DATE_SCHEMA: SchemaObject = { type: 'string', format: 'date' };
const DATE_TIME_SCHEMA: SchemaObject = {
  type: 'string',
  format: 'date-time',
};
const AMOUNT_SCHEMA: SchemaObject = {
  type: 'string',
  pattern: '^(?:0\\.(?:0[1-9]|[1-9]\\d)|[1-9]\\d*\\.\\d{2})$',
};

export const TRANSACTION_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'accountId',
    'type',
    'amount',
    'occurredOn',
    'description',
    'status',
    'transferId',
    'transferSide',
    'categoryId',
    'categorizationStatus',
    'categorizationSource',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: UUID_SCHEMA,
    accountId: UUID_SCHEMA,
    type: { type: 'string', enum: TRANSACTION_TYPES },
    amount: AMOUNT_SCHEMA,
    occurredOn: DATE_SCHEMA,
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: TRANSACTION_STATUSES },
    transferId: { ...UUID_SCHEMA, nullable: true },
    transferSide: { type: 'string', enum: TRANSFER_SIDES, nullable: true },
    categoryId: { ...UUID_SCHEMA, nullable: true },
    categorizationStatus: {
      type: 'string',
      enum: CATEGORIZATION_STATUSES,
    },
    categorizationSource: {
      type: 'string',
      enum: CATEGORIZATION_SOURCES,
      nullable: true,
    },
    createdAt: DATE_TIME_SCHEMA,
    updatedAt: DATE_TIME_SCHEMA,
  },
};

export const CREATE_TRANSACTION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId', 'type', 'amount', 'occurredOn'],
  properties: {
    accountId: UUID_SCHEMA,
    type: { type: 'string', enum: ['income', 'expense'] },
    amount: AMOUNT_SCHEMA,
    occurredOn: DATE_SCHEMA,
    description: { type: 'string', nullable: true },
  },
};

export const UPDATE_TRANSACTION_CATEGORY_SCHEMA: SchemaObject = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['categoryId'],
      properties: { categoryId: UUID_SCHEMA },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['categorizationStatus'],
      properties: {
        categorizationStatus: {
          type: 'string',
          enum: ['uncertain', 'unrecognized'],
        },
      },
    },
  ],
};

export const TRANSFER_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: TRANSACTION_SCHEMA,
    },
  },
};

export const CREATE_TRANSFER_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['fromAccountId', 'toAccountId', 'amount', 'occurredOn'],
  properties: {
    fromAccountId: UUID_SCHEMA,
    toAccountId: UUID_SCHEMA,
    amount: AMOUNT_SCHEMA,
    occurredOn: DATE_SCHEMA,
    description: { type: 'string', nullable: true },
  },
};

export const TRANSACTION_PROBLEM_DETAILS_SCHEMA: SchemaObject = {
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
  },
};

export const TRANSACTION_PROBLEM_DETAILS_RESPONSE = {
  content: {
    'application/problem+json': {
      schema: TRANSACTION_PROBLEM_DETAILS_SCHEMA,
    },
  },
  headers: {
    'X-Request-Id': {
      description: 'Canonical request correlation identifier.',
      schema: { type: 'string', format: 'uuid' },
    },
  },
};

export const TRANSACTION_REQUEST_ID_RESPONSE_HEADERS = {
  'X-Request-Id': {
    description: 'Canonical request correlation identifier.',
    schema: { type: 'string', format: 'uuid' },
  },
};

export const CATEGORY_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'name',
    'source',
    'status',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: UUID_SCHEMA,
    name: { type: 'string' },
    source: { type: 'string', enum: ['user'] },
    status: { type: 'string', enum: ['active', 'archived'] },
    archivedAt: { ...DATE_TIME_SCHEMA, nullable: true },
    createdAt: DATE_TIME_SCHEMA,
    updatedAt: DATE_TIME_SCHEMA,
  },
};

export const CREATE_CATEGORY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
  },
};

export const UPDATE_CATEGORY_SCHEMA: SchemaObject = CREATE_CATEGORY_SCHEMA;

export const CATEGORY_RULE_SCHEMA: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'categoryId',
    'conditionField',
    'conditionOperator',
    'conditionValue',
    'priority',
    'status',
    'removedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: UUID_SCHEMA,
    categoryId: UUID_SCHEMA,
    conditionField: { type: 'string', enum: RULE_FIELDS },
    conditionOperator: { type: 'string', enum: RULE_OPERATORS },
    conditionValue: { type: 'string', minLength: 1 },
    priority: {
      type: 'integer',
      minimum: 0,
      maximum: CATEGORY_RULE_PRIORITY_MAX,
    },
    status: { type: 'string', enum: RULE_STATUSES },
    removedAt: { ...DATE_TIME_SCHEMA, nullable: true },
    createdAt: DATE_TIME_SCHEMA,
    updatedAt: DATE_TIME_SCHEMA,
  },
};

export const CREATE_CATEGORY_RULE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'categoryId',
    'conditionField',
    'conditionOperator',
    'conditionValue',
    'priority',
  ],
  properties: {
    categoryId: UUID_SCHEMA,
    conditionField: { type: 'string', enum: RULE_FIELDS },
    conditionOperator: { type: 'string', enum: RULE_OPERATORS },
    conditionValue: { type: 'string', minLength: 1 },
    priority: {
      type: 'integer',
      minimum: 0,
      maximum: CATEGORY_RULE_PRIORITY_MAX,
    },
  },
};

export const UPDATE_CATEGORY_RULE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    categoryId: UUID_SCHEMA,
    conditionField: { type: 'string', enum: RULE_FIELDS },
    conditionOperator: { type: 'string', enum: RULE_OPERATORS },
    conditionValue: { type: 'string', minLength: 1 },
    priority: {
      type: 'integer',
      minimum: 0,
      maximum: CATEGORY_RULE_PRIORITY_MAX,
    },
  },
};

export const TRANSACTION_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: TRANSACTION_SCHEMA },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
};

export const CATEGORY_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: CATEGORY_SCHEMA },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
};

export const CATEGORY_RULE_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['items', 'page', 'pageSize', 'total'],
  properties: {
    items: { type: 'array', items: CATEGORY_RULE_SCHEMA },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
};

export const TRANSACTIONS_OPENAPI_SCHEMAS: Record<string, SchemaObject> = {
  TransactionView: TRANSACTION_SCHEMA,
  CreateTransaction: CREATE_TRANSACTION_SCHEMA,
  UpdateTransactionCategory: UPDATE_TRANSACTION_CATEGORY_SCHEMA,
  TransferView: TRANSFER_SCHEMA,
  CreateTransfer: CREATE_TRANSFER_SCHEMA,
  TransactionPage: TRANSACTION_PAGE_SCHEMA,
  CategoryView: CATEGORY_SCHEMA,
  CreateCategory: CREATE_CATEGORY_SCHEMA,
  UpdateCategory: UPDATE_CATEGORY_SCHEMA,
  CategoryPage: CATEGORY_PAGE_SCHEMA,
  CategoryRuleView: CATEGORY_RULE_SCHEMA,
  CreateCategoryRule: CREATE_CATEGORY_RULE_SCHEMA,
  UpdateCategoryRule: UPDATE_CATEGORY_RULE_SCHEMA,
  CategoryRulePage: CATEGORY_RULE_PAGE_SCHEMA,
};
