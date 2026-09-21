import type { Prisma } from '../../../../generated/prisma/client.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { IdempotencyRecordUnavailable } from '../../application/transactions.errors.js';
import type {
  IdempotencyClaim,
  IdempotencyOperation,
  IdempotencyRecord,
  IdempotencyStatus,
  TenantIdempotencyRepository,
} from '../../application/ports/idempotency.repository.port.js';

type RawIdempotencyRecord = Readonly<{
  id: string;
  tenant_id: string;
  operation: string;
  key: string;
  payload_hash: string;
  status: string;
  resource_ids: unknown;
  created_at: Date | string;
  expires_at: Date | string;
}>;

export class PrismaTenantIdempotencyRepository implements TenantIdempotencyRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async find(
    operation: IdempotencyOperation,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const rows = await this.transaction.$queryRaw<RawIdempotencyRecord[]>`
      SELECT
        id,
        tenant_id,
        operation,
        key,
        payload_hash,
        status,
        resource_ids,
        created_at,
        expires_at
      FROM public.idempotency_keys
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND operation = ${operation}
        AND key = ${key}
      LIMIT 1
    `;
    return rows[0] ? toIdempotencyRecord(rows[0]) : null;
  }

  async claim(
    operation: IdempotencyOperation,
    key: string,
    payloadHash: string,
  ): Promise<IdempotencyClaim> {
    const inserted = await this.transaction.$queryRaw<RawIdempotencyRecord[]>`
      INSERT INTO public.idempotency_keys (
        tenant_id,
        operation,
        key,
        payload_hash,
        status,
        resource_ids,
        created_at,
        expires_at
      )
      VALUES (
        ${this.context.tenantId}::uuid,
        ${operation},
        ${key},
        ${payloadHash},
        'pending'::public.idempotency_status,
        '[]'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + INTERVAL '24 hours'
      )
      ON CONFLICT (tenant_id, operation, key) DO NOTHING
      RETURNING
        id,
        tenant_id,
        operation,
        key,
        payload_hash,
        status,
        resource_ids,
        created_at,
        expires_at
    `;

    if (inserted[0]) {
      return { claimed: true, record: toIdempotencyRecord(inserted[0]) };
    }

    const existing = await this.find(operation, key);
    if (!existing) throw new IdempotencyRecordUnavailable();
    return { claimed: false, record: existing };
  }

  async complete(id: string, resourceIds: readonly string[]): Promise<void> {
    const result = await this.transaction.$executeRaw`
      UPDATE public.idempotency_keys
      SET status = 'completed'::public.idempotency_status,
          resource_ids = ${JSON.stringify([...resourceIds])}::jsonb
      WHERE id = ${id}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
        AND status = 'pending'::public.idempotency_status
    `;
    if (result !== 1) throw new IdempotencyRecordUnavailable();
  }
}

function toIdempotencyRecord(record: RawIdempotencyRecord): IdempotencyRecord {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    operation: toOperation(record.operation),
    key: record.key,
    payloadHash: record.payload_hash,
    status: toStatus(record.status),
    resourceIds: toResourceIds(record.resource_ids),
    createdAt: toIsoString(record.created_at),
    expiresAt: toIsoString(record.expires_at),
  };
}

function toOperation(value: string): IdempotencyOperation {
  if (value === 'transaction_create' || value === 'transfer_create') {
    return value;
  }
  throw new IdempotencyRecordUnavailable();
}

function toStatus(value: string): IdempotencyStatus {
  if (value === 'pending' || value === 'completed') return value;
  throw new IdempotencyRecordUnavailable();
}

function toResourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new IdempotencyRecordUnavailable();
  }
  const resourceIds = value as unknown[];
  if (resourceIds.some((resourceId) => typeof resourceId !== 'string')) {
    throw new IdempotencyRecordUnavailable();
  }
  return resourceIds.filter(
    (resourceId): resourceId is string => typeof resourceId === 'string',
  );
}

function toIsoString(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
