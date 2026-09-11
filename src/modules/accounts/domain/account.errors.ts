export class InvalidAccountName extends Error {
  override readonly name = 'InvalidAccountName';
}

export class InvalidInstitution extends Error {
  override readonly name = 'InvalidInstitution';
}

export class InvalidAccountType extends Error {
  override readonly name = 'InvalidAccountType';
}

export class InvalidMoney extends Error {
  override readonly name = 'InvalidMoney';
}

export class InvalidBalanceReferenceDate extends Error {
  override readonly name = 'InvalidBalanceReferenceDate';
}

export class ExternalAccountConflict extends Error {
  override readonly name = 'ExternalAccountConflict';
}

export class OwnerNotFound extends Error {
  override readonly name = 'OwnerNotFound';
}

export class TenantMismatch extends Error {
  override readonly name = 'TenantMismatch';
}

export class AccountArchived extends Error {
  override readonly name = 'AccountArchived';
}

export class ConnectedAccountReadOnly extends Error {
  override readonly name = 'ConnectedAccountReadOnly';
}

export class BalanceReferencePairRequired extends Error {
  override readonly name = 'BalanceReferencePairRequired';
}

export class InvalidAccountState extends Error {
  override readonly name = 'InvalidAccountState';
}

export class AccountNotFound extends Error {
  override readonly name = 'AccountNotFound';
}
