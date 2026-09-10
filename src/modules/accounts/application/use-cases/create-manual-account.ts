import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { Account } from '../../domain/account.js';
import type { AccountView } from '../account-view.js';
import { PossibleConnectedAccountDuplicate } from '../accounts.errors.js';
import type { AccountsRepository } from '../ports/accounts.repository.port.js';

export type CreateManualAccountInput = Readonly<{
  name: string;
  type: string;
  institutionName?: string | null;
  initialBalance: string;
  initialBalanceAsOf: string;
  confirmPossibleDuplicate: boolean;
}>;

export class CreateManualAccount {
  constructor(private readonly accounts: AccountsRepository) {}

  execute(
    context: TenantContext,
    input: CreateManualAccountInput,
  ): Promise<AccountView> {
    const account = Account.createManual({
      tenantId: context.tenantId,
      name: input.name,
      type: input.type,
      institutionName: input.institutionName,
      initialBalance: input.initialBalance,
      initialBalanceAsOf: input.initialBalanceAsOf,
    });

    return this.accounts.withTenant(context, async (repository) => {
      const candidates =
        await repository.findPossibleConnectedDuplicates(account);
      if (candidates.length > 0 && !input.confirmPossibleDuplicate) {
        throw new PossibleConnectedAccountDuplicate(candidates);
      }
      return repository.createManual(account);
    });
  }
}
