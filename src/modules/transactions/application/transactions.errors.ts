export class TransactionNotFound extends Error {
  override readonly name = 'TransactionNotFound';
}

export class TransactionAccountNotFound extends Error {
  override readonly name = 'TransactionAccountNotFound';
}

export class CategoryNotFound extends Error {
  override readonly name = 'CategoryNotFound';
}

export class CategoryArchived extends Error {
  override readonly name = 'CategoryArchived';
}

export class TransactionsTenantMismatch extends Error {
  override readonly name = 'TransactionsTenantMismatch';
}
