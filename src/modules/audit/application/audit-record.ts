const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const AUDIT_CHANGED_FIELDS = [
  'name',
  'type',
  'institutionName',
  'initialBalance',
  'initialBalanceAsOf',
] as const;

export type AuditChangedField = (typeof AUDIT_CHANGED_FIELDS)[number];
export type AuditAction = 'account_updated' | 'account_deactivated';
export type AuditStateTransition = 'active_to_archived' | 'already_archived';

export type AuditMetadata =
  | Readonly<{ changedFields: readonly AuditChangedField[] }>
  | Readonly<{ stateTransition: AuditStateTransition }>;

export type AuditRecordProps = Readonly<{
  tenantId: string;
  actorUserId: string;
  action: AuditAction;
  resourceType: 'account';
  resourceId: string;
  outcome: 'success';
  requestId: string;
  metadata: AuditMetadata;
}>;

export class InvalidAuditRecord extends Error {
  override readonly name = 'InvalidAuditRecord';
}

export class AuditRecord {
  private constructor(readonly props: AuditRecordProps) {}

  static create(input: AuditRecordProps): AuditRecord {
    if (
      !CANONICAL_UUID.test(input.tenantId) ||
      !CANONICAL_UUID.test(input.actorUserId) ||
      !CANONICAL_UUID.test(input.resourceId) ||
      !CANONICAL_UUID.test(input.requestId)
    ) {
      throw new InvalidAuditRecord(
        'Audit identifiers must be canonical UUIDs.',
      );
    }

    if (
      input.resourceType !== 'account' ||
      input.outcome !== 'success' ||
      !isValidMetadata(input.action, input.metadata)
    ) {
      throw new InvalidAuditRecord('Audit action or metadata is invalid.');
    }

    const metadataSize = new TextEncoder().encode(
      JSON.stringify(input.metadata),
    ).byteLength;
    if (metadataSize > 2048) {
      throw new InvalidAuditRecord('Audit metadata exceeds 2048 bytes.');
    }

    return new AuditRecord(input);
  }
}

function isValidMetadata(
  action: AuditAction,
  metadata: AuditMetadata,
): boolean {
  if (action === 'account_updated') {
    if (!hasOnlyKey(metadata, 'changedFields')) return false;
    return metadata.changedFields.every((field) =>
      AUDIT_CHANGED_FIELDS.includes(field),
    );
  }

  if (!hasOnlyKey(metadata, 'stateTransition')) return false;
  return (
    metadata.stateTransition === 'active_to_archived' ||
    metadata.stateTransition === 'already_archived'
  );
}

function hasOnlyKey<T extends string>(
  value: object,
  key: T,
): value is Record<T, unknown> {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}
