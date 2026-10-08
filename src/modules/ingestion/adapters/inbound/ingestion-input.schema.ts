import { z } from 'zod';

const canonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
);

export const ingestionIdempotencyKeySchema = z.string().min(1).max(255);

export const previewOfxInputSchema = z
  .object({ destinationAccountId: canonicalUuidSchema })
  .strict();

export const confirmOfxInputSchema = z
  .object({ destinationAccountId: canonicalUuidSchema })
  .strict();

export const importRunIdSchema = canonicalUuidSchema;

export const uploadedOfxFileSchema = z.object({
  buffer: z.instanceof(Buffer),
});
