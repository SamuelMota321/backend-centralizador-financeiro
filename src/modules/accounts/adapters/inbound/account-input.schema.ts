import { z } from 'zod';
import { ACCOUNT_TYPES } from '../../domain/account-type.js';
import { BalanceReferenceDate } from '../../domain/balance-reference-date.js';
import { Money } from '../../domain/money.js';
import {
  normalizeAccountName,
  normalizeInstitution,
} from '../../domain/text-normalization.js';

export const manualAccountInputSchema = z
  .object({
    name: z.string().transform((value, context) => {
      try {
        return normalizeAccountName(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'Invalid name',
        });
        return z.NEVER;
      }
    }),
    type: z.enum(ACCOUNT_TYPES),
    institutionName: z
      .string()
      .nullish()
      .transform((value, context) => {
        try {
          return normalizeInstitution(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message:
              error instanceof Error ? error.message : 'Invalid institution',
          });
          return z.NEVER;
        }
      }),
    initialBalance: z.string().superRefine((value, context) => {
      try {
        Money.fromDecimal(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'Invalid money',
        });
      }
    }),
    initialBalanceAsOf: z.string().superRefine((value, context) => {
      try {
        BalanceReferenceDate.create(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'Invalid date',
        });
      }
    }),
    confirmPossibleDuplicate: z.boolean().default(false),
  })
  .strict();

export type ManualAccountInput = z.infer<typeof manualAccountInputSchema>;

const updateAccountObjectSchema = z
  .object({
    name: z
      .string()
      .transform((value, context) => {
        try {
          return normalizeAccountName(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Invalid name',
          });
          return z.NEVER;
        }
      })
      .optional(),
    type: z.enum(ACCOUNT_TYPES).optional(),
    institutionName: z
      .string()
      .nullable()
      .transform((value, context) => {
        try {
          return normalizeInstitution(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message:
              error instanceof Error ? error.message : 'Invalid institution',
          });
          return z.NEVER;
        }
      })
      .optional(),
    initialBalance: z
      .string()
      .superRefine((value, context) => {
        try {
          Money.fromDecimal(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Invalid money',
          });
        }
      })
      .optional(),
    initialBalanceAsOf: z
      .string()
      .superRefine((value, context) => {
        try {
          BalanceReferenceDate.create(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : 'Invalid date',
          });
        }
      })
      .optional(),
    confirmPossibleDuplicate: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const businessFields = [
      'name',
      'type',
      'institutionName',
      'initialBalance',
      'initialBalanceAsOf',
    ] as const;
    if (!businessFields.some((field) => Object.hasOwn(value, field))) {
      context.addIssue({
        code: 'custom',
        message: 'EMPTY_PATCH',
      });
    }

    const hasBalance = Object.hasOwn(value, 'initialBalance');
    const hasBalanceDate = Object.hasOwn(value, 'initialBalanceAsOf');
    if (hasBalance !== hasBalanceDate) {
      context.addIssue({
        code: 'custom',
        path: [hasBalance ? 'initialBalanceAsOf' : 'initialBalance'],
        message: 'BALANCE_REFERENCE_PAIR_REQUIRED',
      });
    }
  });

export const updateAccountInputSchema = updateAccountObjectSchema;
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

export const deactivateAccountBodySchema = z.undefined();

export const canonicalAccountIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
