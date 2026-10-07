export class InvalidOfxFile extends Error {
  override readonly name = 'InvalidOfxFile';
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
