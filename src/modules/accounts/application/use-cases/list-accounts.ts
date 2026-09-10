import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AccountPage } from '../account-view.js';
import type { AccountsRepository } from '../ports/accounts.repository.port.js';

export type ListAccountsInput = Readonly<{
  page: number;
  pageSize: number;
}>;

export class ListAccounts {
  constructor(private readonly accounts: AccountsRepository) {}

  execute(
    context: TenantContext,
    input: ListAccountsInput,
  ): Promise<AccountPage> {
    return this.accounts.withTenant(context, async (repository) => {
      const total = await repository.countActive();
      const offset = BigInt(input.page - 1) * BigInt(input.pageSize);
      const items =
        offset >= BigInt(total)
          ? []
          : await repository.findActive(Number(offset), input.pageSize);
      return {
        items,
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    });
  }
}
