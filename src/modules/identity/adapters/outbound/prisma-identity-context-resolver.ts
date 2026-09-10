import { Injectable } from '@nestjs/common';
import type { IdentityContextResolver } from '../../application/ports/identity-context-resolver.port.js';
import type { ExternalIdentity } from '../../domain/external-identity.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { PrismaService } from '../../../../infrastructure/database/prisma.service.js';

type ResolvedIdentityRow = Readonly<{
  user_id: string;
  tenant_id: string;
}>;

@Injectable()
export class PrismaIdentityContextResolver implements IdentityContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrProvision(identity: ExternalIdentity): Promise<TenantContext> {
    const rows = await this.prisma.$queryRaw<ResolvedIdentityRow[]>`
      SELECT user_id, tenant_id
      FROM app_private.resolve_or_provision_identity(
        ${identity.provider},
        ${identity.issuer},
        ${identity.subject}
      )
    `;
    const row = rows[0];
    if (!row) {
      throw new Error('Identity resolution returned no context.');
    }
    return { userId: row.user_id, tenantId: row.tenant_id };
  }
}
