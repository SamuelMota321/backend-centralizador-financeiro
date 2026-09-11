import type { Prisma } from '../../../../generated/prisma/client.js';
import type { AuditWriter } from '../../application/ports/audit-writer.port.js';
import type { AuditRecord } from '../../application/audit-record.js';

export class PrismaAuditWriter implements AuditWriter {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async write(record: AuditRecord): Promise<void> {
    await this.transaction.$executeRaw`
      INSERT INTO public.audit_records (
        tenant_id,
        actor_user_id,
        action,
        resource_type,
        resource_id,
        outcome,
        request_id,
        metadata
      ) VALUES (
        ${record.props.tenantId}::uuid,
        ${record.props.actorUserId}::uuid,
        ${record.props.action}::public.audit_action,
        ${record.props.resourceType}::public.audit_resource_type,
        ${record.props.resourceId}::uuid,
        ${record.props.outcome}::public.audit_outcome,
        ${record.props.requestId}::uuid,
        ${JSON.stringify(record.props.metadata)}::jsonb
      )
    `;
  }
}
