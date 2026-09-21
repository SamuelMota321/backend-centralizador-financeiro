export type IdempotencyOperation = 'transaction_create' | 'transfer_create';

export type IdempotencyStatus = 'pending' | 'completed';

export type IdempotencyRecord = Readonly<{
  id: string;
  tenantId: string;
  operation: IdempotencyOperation;
  key: string;
  payloadHash: string;
  status: IdempotencyStatus;
  resourceIds: readonly string[];
  createdAt: string;
  expiresAt: string;
}>;

export type IdempotencyClaim = Readonly<{
  claimed: boolean;
  record: IdempotencyRecord;
}>;

export interface TenantIdempotencyRepository {
  find(
    operation: IdempotencyOperation,
    key: string,
  ): Promise<IdempotencyRecord | null>;
  claim(
    operation: IdempotencyOperation,
    key: string,
    payloadHash: string,
  ): Promise<IdempotencyClaim>;
  complete(id: string, resourceIds: readonly string[]): Promise<void>;
}
