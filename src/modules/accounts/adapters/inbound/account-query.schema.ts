import { z } from 'zod';

export const accountQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().safe().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type AccountQuery = z.infer<typeof accountQuerySchema>;
