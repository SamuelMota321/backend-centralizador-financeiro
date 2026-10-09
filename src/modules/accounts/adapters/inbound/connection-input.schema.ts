import { z } from 'zod';

export const connectionIdSchema = z.string().uuid();

export const pluggyCompletionBodySchema = z
  .object({
    itemId: z.string().uuid(),
  })
  .strict();

export const pluggyWebhookEventSchema = z.object({
  event: z.string().startsWith('item/'),
  eventId: z.string().uuid(),
  itemId: z.string().uuid(),
  clientUserId: z.string().min(1),
});
