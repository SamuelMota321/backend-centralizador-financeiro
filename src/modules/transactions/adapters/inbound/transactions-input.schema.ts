import { z } from 'zod';
import { CATEGORY_RULE_PRIORITY_MAX } from '../../domain/category-rule.js';

export const canonicalUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
const amountSchema = z
  .string()
  .regex(/^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d*\.\d{2})$/);
const civilDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const transactionInputSchema = z
  .object({
    accountId: canonicalUuidSchema,
    type: z.enum(['income', 'expense']),
    amount: amountSchema,
    occurredOn: civilDateSchema,
    description: z.string().nullable().optional(),
  })
  .strict();

export const transferInputSchema = z
  .object({
    fromAccountId: canonicalUuidSchema,
    toAccountId: canonicalUuidSchema,
    amount: amountSchema,
    occurredOn: civilDateSchema,
    description: z.string().nullable().optional(),
  })
  .strict();

export const idempotencyKeySchema = z.string().min(1).max(255);

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const transactionIdSchema = canonicalUuidSchema;

export const transactionCategoryInputSchema = z.union([
  z.object({ categoryId: canonicalUuidSchema }).strict(),
  z
    .object({
      categorizationStatus: z.enum(['uncertain', 'unrecognized']),
    })
    .strict(),
]);

export const categoryInputSchema = z
  .object({ name: z.string().min(1).max(100) })
  .strict();

export const categoryRuleInputSchema = z
  .object({
    categoryId: canonicalUuidSchema,
    conditionField: z.enum(['description', 'type', 'accountId']),
    conditionOperator: z.enum([
      'equals',
      'contains',
      'starts_with',
      'ends_with',
    ]),
    conditionValue: z.string().min(1),
    priority: z.number().int().min(0).max(CATEGORY_RULE_PRIORITY_MAX),
  })
  .strict();

export const categoryRuleUpdateInputSchema = z
  .object({
    categoryId: canonicalUuidSchema.optional(),
    conditionField: z.enum(['description', 'type', 'accountId']).optional(),
    conditionOperator: z
      .enum(['equals', 'contains', 'starts_with', 'ends_with'])
      .optional(),
    conditionValue: z.string().min(1).optional(),
    priority: z
      .number()
      .int()
      .min(0)
      .max(CATEGORY_RULE_PRIORITY_MAX)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'EMPTY_PATCH',
  });

export const noBodySchema = z.undefined();

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransferInput = z.infer<typeof transferInputSchema>;
export type TransactionCategoryInput = z.infer<
  typeof transactionCategoryInputSchema
>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CategoryRuleInput = z.infer<typeof categoryRuleInputSchema>;
export type CategoryRuleUpdateInput = z.infer<
  typeof categoryRuleUpdateInputSchema
>;
