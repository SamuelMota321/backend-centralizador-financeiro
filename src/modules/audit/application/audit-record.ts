const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const AUDIT_CHANGED_FIELDS = [
  'name',
  'type',
  'institutionName',
  'initialBalance',
  'initialBalanceAsOf',
  'categoryId',
  'categorizationStatus',
  'categorizationSource',
  'conditionField',
  'conditionOperator',
  'conditionValue',
  'priority',
  'status',
] as const;

export type AuditChangedField = (typeof AUDIT_CHANGED_FIELDS)[number];
export type AuditAction =
  | 'account_updated'
  | 'account_deactivated'
  | 'transaction_created'
  | 'transfer_created'
  | 'transaction_category_updated'
  | 'category_created'
  | 'category_updated'
  | 'category_archived'
  | 'category_rule_created'
  | 'category_rule_updated'
  | 'category_rule_activated'
  | 'category_rule_deactivated'
  | 'category_rule_removed';
export type AuditStateTransition = 'active_to_archived' | 'already_archived';

export type AuditMetadata =
  | Readonly<{ changedFields: readonly AuditChangedField[] }>
  | Readonly<{ stateTransition: AuditStateTransition }>;

export type AuditRecordProps = Readonly<{
  tenantId: string;
  actorUserId: string;
  action: AuditAction;
  resourceType: 'account' | 'transaction' | 'category' | 'category_rule';
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
      input.outcome !== 'success' ||
      !isResourceForAction(input.action, input.resourceType) ||
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

function isResourceForAction(
  action: AuditAction,
  resourceType: AuditRecordProps['resourceType'],
): boolean {
  if (action === 'account_updated' || action === 'account_deactivated') {
    return resourceType === 'account';
  }
  if (
    action === 'transaction_created' ||
    action === 'transfer_created' ||
    action === 'transaction_category_updated'
  ) {
    return resourceType === 'transaction';
  }
  if (
    action === 'category_created' ||
    action === 'category_updated' ||
    action === 'category_archived'
  ) {
    return resourceType === 'category';
  }
  return resourceType === 'category_rule';
}

function isValidMetadata(
  action: AuditAction,
  metadata: AuditMetadata,
): boolean {
  if (
    action === 'account_updated' ||
    action === 'transaction_created' ||
    action === 'transfer_created' ||
    action === 'transaction_category_updated' ||
    action === 'category_created' ||
    action === 'category_updated' ||
    action === 'category_rule_created' ||
    action === 'category_rule_updated' ||
    action === 'category_rule_activated' ||
    action === 'category_rule_deactivated' ||
    action === 'category_rule_removed'
  ) {
    if (!hasOnlyKey(metadata, 'changedFields')) return false;
    const allowedFields =
      action === 'account_updated'
        ? ['name', 'type', 'institutionName', 'initialBalance', 'initialBalanceAsOf']
        : action === 'transaction_created' || action === 'transfer_created'
          ? []
        : action === 'transaction_category_updated'
          ? ['categoryId', 'categorizationStatus', 'categorizationSource']
          : action === 'category_created' || action === 'category_updated'
            ? ['name']
            : action === 'category_rule_activated' ||
                action === 'category_rule_deactivated' ||
                action === 'category_rule_removed'
              ? ['status']
              : [
                  'categoryId',
                  'conditionField',
                  'conditionOperator',
                  'conditionValue',
                  'priority',
                ];
    return metadata.changedFields.every((field) =>
      allowedFields.includes(field),
    );
  }

  if (
    action === 'account_deactivated' ||
    action === 'category_archived'
  ) {
    if (!hasOnlyKey(metadata, 'stateTransition')) return false;
    return (
      metadata.stateTransition === 'active_to_archived' ||
      metadata.stateTransition === 'already_archived'
    );
  }

  return false;
}

function hasOnlyKey<T extends string>(
  value: object,
  key: T,
): value is Record<T, unknown> {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === key;
}
