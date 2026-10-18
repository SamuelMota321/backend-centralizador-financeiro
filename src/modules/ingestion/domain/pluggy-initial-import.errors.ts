export class PluggyInitialImportNotFound extends Error {
  override readonly name = 'PluggyInitialImportNotFound';
}

export class PluggyInitialImportConflict extends Error {
  override readonly name = 'PluggyInitialImportConflict';
}

export class PluggyInitialImportIdempotencyConflict extends Error {
  override readonly name = 'PluggyInitialImportIdempotencyConflict';
}
