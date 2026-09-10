import { describe, expect, it } from 'vitest';
import { ExternalIdentity } from './external-identity.js';
import { InvalidExternalIdentity } from './identity.errors.js';

describe('ExternalIdentity', () => {
  it('preserves opaque, case-sensitive claims', () => {
    const identity = ExternalIdentity.auth0(
      'https://tenant.auth0.com/',
      'Auth0|CaseSensitive',
    );
    expect(identity.subject).toBe('Auth0|CaseSensitive');
  });

  it.each([
    ['http://tenant.auth0.com/', 'auth0|1'],
    [' https://tenant.auth0.com/', 'auth0|1'],
    ['https://tenant.auth0.com/', ''],
    ['https://tenant.auth0.com/', 'auth0|line\nbreak'],
  ])('rejects invalid issuer/subject', (issuer, subject) => {
    expect(() => ExternalIdentity.auth0(issuer, subject)).toThrow(
      InvalidExternalIdentity,
    );
  });
});
