import {
  Injectable,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

type SecurityState = Readonly<{
  role_name: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  owns_protected_table: boolean;
}>;

@Injectable()
export class DatabaseSecurityCheckService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.assertRuntimeRoleIsSafe();
  }

  async assertRuntimeRoleIsSafe(): Promise<void> {
    const rows = await this.prisma.$queryRaw<SecurityState[]>`
      SELECT
        current_user AS role_name,
        role.rolsuper AS is_superuser,
        role.rolbypassrls AS bypasses_rls,
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class protected
          WHERE protected.oid IN (
            'public.tenants'::regclass,
            'public.users'::regclass,
            'public.identity_links'::regclass,
            'public.accounts'::regclass,
            'public.audit_records'::regclass
          )
          AND protected.relowner = (current_user::regrole)::oid
        ) AS owns_protected_table
      FROM pg_catalog.pg_roles role
      WHERE role.rolname = current_user
    `;
    const state = rows[0];
    if (
      !state ||
      state.role_name !== 'cfi_runtime' ||
      state.is_superuser ||
      state.bypasses_rls ||
      state.owns_protected_table
    ) {
      throw new ServiceUnavailableException(
        'Database runtime role does not satisfy the security baseline.',
      );
    }
  }
}
