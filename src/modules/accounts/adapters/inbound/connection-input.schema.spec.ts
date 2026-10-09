import { describe, expect, it } from 'vitest';
import { pluggyWebhookEventSchema } from './connection-input.schema.js';

describe('Pluggy webhook input schema', () => {
  it('strips provider-specific payload fields before queuing the event', () => {
    const parsed = pluggyWebhookEventSchema.parse({
      event: 'item/error',
      eventId: '77aa7777-7777-4777-8777-777777777777',
      itemId: '55aa5555-5555-4555-8555-555555555555',
      clientUserId:
        '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee:660e6d8c-88b8-48e9-99f7-635d6e868e2a:164aa078-983d-4c39-aae4-dda44b495970',
      triggeredBy: 'USER',
      error: { message: 'provider detail' },
    });

    expect(parsed).toEqual({
      event: 'item/error',
      eventId: '77aa7777-7777-4777-8777-777777777777',
      itemId: '55aa5555-5555-4555-8555-555555555555',
      clientUserId:
        '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee:660e6d8c-88b8-48e9-99f7-635d6e868e2a:164aa078-983d-4c39-aae4-dda44b495970',
    });
  });
});
