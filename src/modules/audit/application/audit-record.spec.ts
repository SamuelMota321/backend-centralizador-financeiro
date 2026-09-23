import { describe, expect, it } from 'vitest';
import { AuditRecord, InvalidAuditRecord } from './audit-record.js';

const base = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  actorUserId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
  resourceType: 'account' as const,
  resourceId: '164aa078-983d-4c39-aae4-dda44b495970',
  outcome: 'success' as const,
  requestId: '264aa078-983d-4c39-aae4-dda44b495970',
};

describe('AuditRecord', () => {
  it('accepts the minimum update metadata', () => {
    expect(
      AuditRecord.create({
        ...base,
        action: 'account_updated',
        metadata: { changedFields: ['name', 'type'] },
      }).props.metadata,
    ).toEqual({ changedFields: ['name', 'type'] });
  });

  it('rejects metadata keys outside the action contract', () => {
    expect(() =>
      AuditRecord.create({
        ...base,
        action: 'account_deactivated',
        metadata: {
          stateTransition: 'active_to_archived',
          before: 'sensitive',
        } as never,
      }),
    ).toThrow(InvalidAuditRecord);
  });

  it('rejects invalid identifiers and oversized metadata', () => {
    expect(() =>
      AuditRecord.create({
        ...base,
        requestId: 'invalid',
        action: 'account_updated',
        metadata: { changedFields: [] },
      }),
    ).toThrow(InvalidAuditRecord);

    expect(() =>
      AuditRecord.create({
        ...base,
        action: 'account_updated',
        metadata: {
          changedFields: Array.from({ length: 500 }, () => 'name'),
        },
      }),
    ).toThrow(InvalidAuditRecord);
  });

  it('accepts categorization and rule audit actions without domain values', () => {
    expect(
      AuditRecord.create({
        ...base,
        action: 'transaction_category_updated',
        resourceType: 'transaction',
        metadata: {
          changedFields: [
            'categoryId',
            'categorizationStatus',
            'categorizationSource',
          ],
        },
      }).props.resourceType,
    ).toBe('transaction');
    expect(
      AuditRecord.create({
        ...base,
        action: 'category_rule_removed',
        resourceType: 'category_rule',
        metadata: { changedFields: ['status'] },
      }).props.action,
    ).toBe('category_rule_removed');
  });

  it('rejects an action/resource pair outside the audit contract', () => {
    expect(() =>
      AuditRecord.create({
        ...base,
        action: 'category_updated',
        resourceType: 'transaction',
        metadata: { changedFields: ['name'] },
      }),
    ).toThrow(InvalidAuditRecord);
  });
});
