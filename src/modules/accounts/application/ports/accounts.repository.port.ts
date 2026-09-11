import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { Account, AccountSnapshot } from '../../domain/account.js';
import type { AccountView, DuplicateCandidate } from '../account-view.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

export interface TenantAccountsRepository {
  findPossibleConnectedDuplicates(
    account: Account,
    excludedAccountId?: string,
  ): Promise<DuplicateCandidate[]>;
  createManual(account: Account): Promise<AccountView>;
  countActive(): Promise<number>;
  findActive(offset: number, limit: number): Promise<AccountView[]>;
  findByIdForUpdate(accountId: string): Promise<AccountSnapshot | null>;
  update(accountId: string, account: Account): Promise<AccountView>;
  deactivate(accountId: string): Promise<AccountView>;
}

export type AccountMaintenanceScope = Readonly<{
  accounts: TenantAccountsRepository;
  audit: AuditWriter;
}>;

export interface AccountsRepository {
  withTenant<Result>(
    context: TenantContext,
    operation: (repository: TenantAccountsRepository) => Promise<Result>,
  ): Promise<Result>;
}
