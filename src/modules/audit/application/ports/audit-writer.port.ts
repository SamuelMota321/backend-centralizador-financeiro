import type { AuditRecord } from '../audit-record.js';

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

export interface AuditWriter {
  write(record: AuditRecord): Promise<void>;
}
