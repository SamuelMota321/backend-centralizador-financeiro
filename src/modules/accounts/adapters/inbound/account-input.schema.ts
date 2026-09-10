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
