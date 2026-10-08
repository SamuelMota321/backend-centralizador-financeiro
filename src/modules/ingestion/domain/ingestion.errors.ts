export class InvalidOfxFile extends Error {
  override readonly name = 'InvalidOfxFile';
}

export class UnsupportedOfxMediaType extends Error {
  override readonly name = 'UnsupportedOfxMediaType';
}

export class IngestionObjectStoreUnavailable extends Error {
  override readonly name = 'IngestionObjectStoreUnavailable';
}

export class IngestionIdempotencyKeyReused extends Error {
  override readonly name = 'IngestionIdempotencyKeyReused';
}

export class IngestionIdempotencyKeyExpired extends Error {
  override readonly name = 'IngestionIdempotencyKeyExpired';
}

export class IngestionIdempotencyRecordUnavailable extends Error {
  override readonly name = 'IngestionIdempotencyRecordUnavailable';
}

export class InvalidOfxDestinationAccount extends Error {
  override readonly name = 'InvalidOfxDestinationAccount';
}

export class ImportRunNotFound extends Error {
  override readonly name = 'ImportRunNotFound';
}

export class ImportRunConflict extends Error {
  override readonly name = 'ImportRunConflict';
}

export class InvalidImportRunTransition extends Error {
  override readonly name = 'InvalidImportRunTransition';
}
