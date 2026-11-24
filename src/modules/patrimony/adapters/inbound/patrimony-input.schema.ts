import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !Array.from(value).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    );
const amount = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.uuid();

export const assetInput = z
  .object({
    type: text(80),
    description: text(500),
    estimatedValue: amount,
    valuationDate: date,
    source: text(120),
  })
  .strict();
export const financingInput = z
  .object({
    description: text(500),
    outstandingBalance: amount,
    assetId: uuid.nullable().optional(),
  })
  .strict();
export const liabilityInput = z
  .object({
    description: text(500),
    outstandingBalance: amount,
  })
  .strict();

export const collectionSchema = z.enum(['assets', 'financings', 'liabilities']);
export const pageQuery = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export function parseBody(
  collection: z.infer<typeof collectionSchema>,
  body: unknown,
  patch = false,
) {
  if (collection === 'assets')
    return patch
      ? assetInput
          .partial()
          .refine((value) => Object.keys(value).length > 0)
          .parse(body)
      : assetInput.parse(body);
  if (collection === 'financings') {
    if (patch)
      return financingInput
        .partial()
        .refine((value) => Object.keys(value).length > 0)
        .parse(body);
    const parsed = financingInput.parse(body);
    return { ...parsed, assetId: parsed.assetId ?? null };
  }
  return patch
    ? liabilityInput
        .partial()
        .refine((value) => Object.keys(value).length > 0)
        .parse(body)
    : liabilityInput.parse(body);
}
