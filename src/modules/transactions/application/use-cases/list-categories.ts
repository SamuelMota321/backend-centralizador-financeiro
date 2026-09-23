import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import { toCategoryView, type CategoryPage } from '../transactions-view.js';

export type ListCategoriesInput = Readonly<{
  page: number;
  pageSize: number;
}>;

export class ListCategories {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    input: ListCategoriesInput,
  ): Promise<CategoryPage> {
    assertTenantContext(context);
    const offset = (input.page - 1) * input.pageSize;
    return this.transactions.withTenant(context, async ({ categories }) => {
      const [total, snapshots] = await Promise.all([
        categories.count(),
        categories.findPage(offset, input.pageSize),
      ]);
      return {
        items: snapshots.map(toCategoryView),
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    });
  }
}
