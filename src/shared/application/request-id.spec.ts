import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

describe('resolveRequestId', () => {
  it('preserves a valid request id in canonical lowercase form', () => {
    expect(resolveRequestId('264AA078-983D-4C39-AAE4-DDA44B495970')).toBe(
      '264aa078-983d-4c39-aae4-dda44b495970',
    );
  });

  it('generates a UUID when the incoming value is absent or invalid', () => {
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(resolveRequestId('not-a-uuid')).not.toBe('not-a-uuid');
  });
});
