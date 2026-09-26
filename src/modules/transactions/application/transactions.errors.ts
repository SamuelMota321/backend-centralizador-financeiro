export class TransactionNotFound extends Error {
  override readonly name = 'TransactionNotFound';
}

export class TransactionAccountNotFound extends Error {
  override readonly name = 'TransactionAccountNotFound';
}

export class CategoryNotFound extends Error {
  override readonly name = 'CategoryNotFound';
}

export class CategoryNameConflict extends Error {
  override readonly name = 'CategoryNameConflict';
}

export class CategoryArchived extends Error {
  override readonly name = 'CategoryArchived';
}

export class TransactionsTenantMismatch extends Error {
  override readonly name = 'TransactionsTenantMismatch';
}

export class InvalidTransactionRequest extends Error {
  override readonly name = 'InvalidTransactionRequest';
}

export class TransactionAccountArchived extends Error {
  override readonly name = 'TransactionAccountArchived';
}

export class TransferAccountsMustDiffer extends Error {
  override readonly name = 'TransferAccountsMustDiffer';
}

export class IdempotencyKeyReused extends Error {
  override readonly name = 'IdempotencyKeyReused';
}

export class IdempotencyKeyExpired extends Error {
  override readonly name = 'IdempotencyKeyExpired';
}

export class IdempotencyRecordUnavailable extends Error {
  override readonly name = 'IdempotencyRecordUnavailable';
}
