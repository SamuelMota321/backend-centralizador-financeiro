import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { Account } from '../../domain/account.js';
import type { AccountView, DuplicateCandidate } from '../account-view.js';

export const ACCOUNTS_REPOSITORY = Symbol('ACCOUNTS_REPOSITORY');

export interface TenantAccountsRepository {
  findPossibleConnectedDuplicates(
    account: Account,
  ): Promise<DuplicateCandidate[]>;
  createManual(account: Account): Promise<AccountView>;
  countActive(): Promise<number>;
  findActive(offset: number, limit: number): Promise<AccountView[]>;
}

export interface AccountsRepository {
  withTenant<Result>(
    context: TenantContext,
    operation: (repository: TenantAccountsRepository) => Promise<Result>,
  ): Promise<Result>;
}
