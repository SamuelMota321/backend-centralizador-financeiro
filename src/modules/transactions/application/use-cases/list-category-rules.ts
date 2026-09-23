import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import {
  toCategoryRuleView,
  type CategoryRulePage,
} from '../transactions-view.js';

export type ListCategoryRulesInput = Readonly<{
  page: number;
  pageSize: number;
}>;

export class ListCategoryRules {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    input: ListCategoryRulesInput,
  ): Promise<CategoryRulePage> {
    assertTenantContext(context);
    const offset = (input.page - 1) * input.pageSize;
    return this.transactions.withTenant(context, async ({ categoryRules }) => {
      const [total, snapshots] = await Promise.all([
        categoryRules.count(),
        categoryRules.findPage(offset, input.pageSize),
      ]);
      return {
        items: snapshots.map(toCategoryRuleView),
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    });
  }
}
