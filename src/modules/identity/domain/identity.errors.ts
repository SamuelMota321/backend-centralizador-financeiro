export class InvalidExternalIdentity extends Error {
  override readonly name = 'InvalidExternalIdentity';
}

export class IdentityAlreadyLinked extends Error {
  override readonly name = 'IdentityAlreadyLinked';
}
