import { InvalidExternalIdentity } from './identity.errors.js';

const FORBIDDEN_CONTROL = /\p{Cc}/u;

function assertOpaqueClaim(value: string, label: string): void {
  if (
    value.length < 1 ||
    value.length > 255 ||
    value !== value.trim() ||
    FORBIDDEN_CONTROL.test(value)
  ) {
    throw new InvalidExternalIdentity(
      `${label} must be an opaque, trimmed value of at most 255 characters.`,
    );
  }
}

export class ExternalIdentity {
  private constructor(
    readonly provider: 'auth0',
    readonly issuer: string,
    readonly subject: string,
  ) {}

  static auth0(issuer: string, subject: string): ExternalIdentity {
    assertOpaqueClaim(issuer, 'Issuer');
    assertOpaqueClaim(subject, 'Subject');
    if (!issuer.startsWith('https://')) {
      throw new InvalidExternalIdentity('Issuer must use HTTPS.');
    }
    return new ExternalIdentity('auth0', issuer, subject);
  }
}
