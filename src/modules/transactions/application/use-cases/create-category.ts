import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { Category } from '../../domain/category.js';
import type {
  TenantCategoriesRepository,
  TransactionsRepository,
} from '../ports/transactions.repository.port.js';
import { toCategoryView, type CategoryView } from '../transactions-view.js';

export type CreateTransactionCategoryInput = Readonly<{
  name: string;
}>;

export class CreateCategory {
  constructor(private readonly transactions: TransactionsRepository) {}

  execute(
    context: TenantContext,
    input: CreateTransactionCategoryInput,
  ): Promise<CategoryView> {
    assertTenantContext(context);
    const category = Category.create({
      tenantId: context.tenantId,
      name: input.name,
    });

    return this.transactions.withTenant(context, async (scope) => {
      const repository: TenantCategoriesRepository = scope.categories;
      const snapshot = await repository.create(category);
      return toCategoryView(snapshot);
    });
  }
}
