export class ConnectionNotFound extends Error {
  override readonly name = 'ConnectionNotFound';
}

export class ConnectionRequestConflict extends Error {
  override readonly name = 'ConnectionRequestConflict';
}

export class InvalidPluggyWebhook extends Error {
  override readonly name = 'InvalidPluggyWebhook';
}
