import type { SchemaObject } from '@nestjs/swagger';

const assetFields = {
  type: { type: 'string', maxLength: 80 },
  description: { type: 'string', maxLength: 500 },
  estimatedValue: { type: 'string', pattern: '^(?:0|[1-9]\\d*)\\.\\d{2}$' },
  valuationDate: { type: 'string', format: 'date' },
  source: { type: 'string', maxLength: 120 },
};
const debtFields = {
  description: { type: 'string', maxLength: 500 },
  outstandingBalance: { type: 'string', pattern: '^(?:0|[1-9]\\d*)\\.\\d{2}$' },
};
const financingFields = {
  ...debtFields,
  assetId: { type: 'string', format: 'uuid', nullable: true },
};
const inputAssetFields = {
  ...assetFields,
  estimatedValue: {
    type: 'string',
    pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$',
  },
};
const inputDebtFields = {
  ...debtFields,
  outstandingBalance: {
    type: 'string',
    pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$',
  },
};
const inputFinancingFields = {
  ...inputDebtFields,
  assetId: financingFields.assetId,
};
const baseFields = {
  id: { type: 'string', format: 'uuid' },
  kind: { type: 'string', enum: ['asset', 'financing', 'liability'] },
  currencyCode: { type: 'string', enum: ['BRL'] },
  version: { type: 'integer', minimum: 1 },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};
const body = (
  fields: Record<string, unknown>,
  required: string[],
): SchemaObject => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties: fields as SchemaObject['properties'],
});
export const CREATE_PATRIMONY_SCHEMA: SchemaObject = {
  anyOf: [
    body(inputAssetFields, Object.keys(inputAssetFields)),
    body(inputFinancingFields, ['description', 'outstandingBalance']),
    body(inputDebtFields, Object.keys(inputDebtFields)),
  ],
};
export const UPDATE_PATRIMONY_SCHEMA: SchemaObject = {
  anyOf: [
    { ...body(inputAssetFields, []), minProperties: 1 },
    { ...body(inputFinancingFields, []), minProperties: 1 },
    { ...body(inputDebtFields, []), minProperties: 1 },
  ],
};
const view = (kind: string, fields: Record<string, unknown>): SchemaObject =>
  body({ ...baseFields, kind: { type: 'string', enum: [kind] }, ...fields }, [
    ...Object.keys(baseFields),
    ...Object.keys(fields),
  ]);
export const PATRIMONY_VIEW_SCHEMA: SchemaObject = {
  oneOf: [
    view('asset', assetFields),
    view('financing', financingFields),
    view('liability', debtFields),
  ],
};
export const PATRIMONY_PAGE_SCHEMA: SchemaObject = body(
  {
    items: { type: 'array', items: PATRIMONY_VIEW_SCHEMA },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    total: { type: 'integer', minimum: 0 },
  },
  ['items', 'page', 'pageSize', 'total'],
);
export const PATRIMONY_HISTORY_SCHEMA: SchemaObject = {
  type: 'array',
  items: body(
    {
      version: { type: 'integer', minimum: 1 },
      actorUserId: { type: 'string', format: 'uuid' },
      requestId: { type: 'string', format: 'uuid' },
      createdAt: { type: 'string', format: 'date-time' },
      state: {
        oneOf: [
          body(assetFields, Object.keys(assetFields)),
          body(financingFields, Object.keys(financingFields)),
          body(debtFields, Object.keys(debtFields)),
        ],
      },
    },
    ['version', 'actorUserId', 'requestId', 'createdAt', 'state'],
  ),
};
export const PATRIMONY_PROBLEM_SCHEMA: SchemaObject = body(
  {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    code: { type: 'string' },
    detail: { type: 'string' },
  },
  ['type', 'title', 'status', 'code', 'detail'],
);
export const PATRIMONY_PROBLEM_RESPONSE = {
  content: { 'application/problem+json': { schema: PATRIMONY_PROBLEM_SCHEMA } },
};
