import { z } from 'zod';

const canonicalUuidSchema = z
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

export const idempotencyKeySchema = z.string().min(1);

export type TransactionInput = z.infer<typeof transactionInputSchema>;
export type TransferInput = z.infer<typeof transferInputSchema>;
