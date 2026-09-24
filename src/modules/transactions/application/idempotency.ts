import { createHash } from 'node:crypto';
import type { IdempotencyRecord } from './ports/idempotency.repository.port.js';
import {
  IdempotencyKeyExpired,
  IdempotencyKeyReused,
  IdempotencyRecordUnavailable,
} from './transactions.errors.js';

export const TRANSACTION_CREATE_OPERATION = 'transaction_create' as const;
export const TRANSFER_CREATE_OPERATION = 'transfer_create' as const;

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

export function hashNormalizedPayload(
  value: Readonly<Record<string, string | null>>,
): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assertReplayable(
  record: IdempotencyRecord,
  payloadHash: string,
  tenantId: string,
  expectedResourceCount: number,
): void {
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new IdempotencyKeyExpired();
  }
  if (record.payloadHash !== payloadHash) {
    throw new IdempotencyKeyReused();
  }
  if (
    record.tenantId !== tenantId ||
    record.status !== 'completed' ||
    record.resourceIds.length !== expectedResourceCount ||
    new Set(record.resourceIds).size !== record.resourceIds.length ||
    record.resourceIds.some((id) => !isCanonicalUuid(id))
  ) {
    throw new IdempotencyRecordUnavailable();
  }
}
