import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AccountView } from '../account-view.js';
import { AccountNotFound } from '../../domain/account.errors.js';
import type { AccountMaintenanceScope } from '../ports/accounts.repository.port.js';

export class DeactivateAccount {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
  ) {}

  execute(
    context: TenantContext,
    accountId: string,
    requestId: string,
  ): Promise<AccountView> {
    if (!isCanonicalUuid(accountId)) {
      throw new AccountNotFound('Account was not found.');
    }

    return this.unitOfWork.run(context, async ({ accounts, audit }) => {
      const current = await accounts.findByIdForUpdate(accountId);
      if (!current) {
        throw new AccountNotFound('Account was not found.');
      }

      const transition =
        current.archivedAt === null ? 'active_to_archived' : 'already_archived';
      const view = await accounts.deactivate(accountId);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'account_deactivated',
          resourceType: 'account',
          resourceId: accountId,
          outcome: 'success',
          requestId,
          metadata: { stateTransition: transition },
        }),
      );
      return view;
    });
  }
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}
