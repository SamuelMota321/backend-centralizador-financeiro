import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { ParsedOfxTransaction } from '../../../ingestion/domain/ofx-statement.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import { createOfxExternalIdentityKey } from '../ofx-identity.js';
import { InvalidTransactionRequest } from '../transactions.errors.js';

export class FindOfxTransactionDuplicates {
  constructor(private readonly repository: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    accountId: string,
    items: readonly ParsedOfxTransaction[],
  ): Promise<readonly boolean[]> {
    assertTenantContext(context);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        accountId,
      )
    ) {
      throw new InvalidTransactionRequest('Invalid import account.');
    }

    const identityKeys = items.map(createOfxExternalIdentityKey);
    const existingKeys = await this.repository.withTenant(
      context,
      (scope) =>
        scope.transactions.findExistingExternalIdentityKeys(
          accountId.toLowerCase(),
          identityKeys,
        ),
    );
    const existing = new Set(existingKeys);
    const seenInFile = new Set<string>();
    return identityKeys.map((identityKey) => {
      const duplicate =
        existing.has(identityKey) || seenInFile.has(identityKey);
      seenInFile.add(identityKey);
      return duplicate;
    });
  }
}
