import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Account, type AccountUpdateProps } from '../../domain/account.js';
import { AccountNotFound } from '../../domain/account.errors.js';
import {
  AuditRecord,
  AUDIT_CHANGED_FIELDS,
} from '../../../audit/application/audit-record.js';
import type { AccountView } from '../account-view.js';
import { PossibleConnectedAccountDuplicate } from '../accounts.errors.js';
import type { AccountMaintenanceScope } from '../ports/accounts.repository.port.js';

export type UpdateAccountInput = Readonly<
  AccountUpdateProps & { confirmPossibleDuplicate: boolean }
>;

export class UpdateAccount {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
  ) {}

  execute(
    context: TenantContext,
    accountId: string,
    requestId: string,
    input: UpdateAccountInput,
  ): Promise<AccountView> {
    if (!isCanonicalUuid(accountId)) {
      throw new AccountNotFound('Account was not found.');
    }

    return this.unitOfWork.run(context, async ({ accounts, audit }) => {
      const current = await accounts.findByIdForUpdate(accountId);
      if (!current) {
        throw new AccountNotFound('Account was not found.');
      }

      const account = Account.reconstitute(current);
      const updatedAccount = account.update(input);
      const identityFieldChanged =
        hasOwn(input, 'name') ||
        hasOwn(input, 'type') ||
        hasOwn(input, 'institutionName');

      if (identityFieldChanged) {
        const candidates = await accounts.findPossibleConnectedDuplicates(
          updatedAccount,
          accountId,
        );
        if (candidates.length > 0 && !input.confirmPossibleDuplicate) {
          throw new PossibleConnectedAccountDuplicate(candidates);
        }
      }

      const view = await accounts.update(accountId, updatedAccount);
      const changedFields = AUDIT_CHANGED_FIELDS.filter((field) =>
        hasChanged(field, account, updatedAccount),
      );
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'account_updated',
          resourceType: 'account',
          resourceId: accountId,
          outcome: 'success',
          requestId,
          metadata: { changedFields },
        }),
      );
      return view;
    });
  }
}

function hasOwn<T extends object, K extends PropertyKey>(
  object: T,
  key: K,
): object is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasChanged(
  field: (typeof AUDIT_CHANGED_FIELDS)[number],
  current: Account,
  updated: Account,
): boolean {
  switch (field) {
    case 'name':
      return current.props.name !== updated.props.name;
    case 'type':
      return current.props.type !== updated.props.type;
    case 'institutionName':
      return current.props.institutionName !== updated.props.institutionName;
    case 'initialBalance':
      return (
        current.props.initialBalance.toDecimal() !==
        updated.props.initialBalance.toDecimal()
      );
    case 'initialBalanceAsOf':
      return (
        current.props.initialBalanceAsOf.value !==
        updated.props.initialBalanceAsOf.value
      );
    default:
      return false;
  }
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}
