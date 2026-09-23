export class InvalidTransactionAmount extends Error {
  override readonly name = 'InvalidTransactionAmount';
}

export class InvalidTransactionDate extends Error {
  override readonly name = 'InvalidTransactionDate';
}

export class InvalidTransactionType extends Error {
  override readonly name = 'InvalidTransactionType';
}

export class InvalidTransactionState extends Error {
  override readonly name = 'InvalidTransactionState';
}

export class TransactionCategorizationNotAllowed extends Error {
  override readonly name = 'TransactionCategorizationNotAllowed';
}

export class InvalidCategoryName extends Error {
  override readonly name = 'InvalidCategoryName';
}

export class InvalidCategoryState extends Error {
  override readonly name = 'InvalidCategoryState';
}

export class InvalidCategoryRule extends Error {
  override readonly name = 'InvalidCategoryRule';
}

export class CategoryRuleRemoved extends Error {
  override readonly name = 'CategoryRuleRemoved';
}

export class CategoryRuleNotFound extends Error {
  override readonly name = 'CategoryRuleNotFound';
}

export class CategoryRuleConflict extends Error {
  override readonly name = 'CategoryRuleConflict';
}
