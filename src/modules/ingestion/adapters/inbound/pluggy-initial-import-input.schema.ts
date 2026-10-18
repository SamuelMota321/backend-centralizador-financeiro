import { z } from 'zod';

export const pluggyAccountMappingBodySchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('link'), accountId: z.string().uuid() })
    .strict(),
  z.object({ action: z.literal('create') }).strict(),
]);

export const pluggyInitialImportJobSchema = z
  .object({
    runId: z.string().uuid(),
    tenantId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();
