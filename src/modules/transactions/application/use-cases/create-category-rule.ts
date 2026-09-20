import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { CategoryRule } from '../../domain/category-rule.js';
import { CategoryArchived, CategoryNotFound } from '../transactions.errors.js';
import {
  toCategoryRuleView,
  type CategoryRuleView,
} from '../transactions-view.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';

export type CreateTransactionCategoryRuleInput = Readonly<{
  categoryId: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  priority: number;
}>;

export class CreateCategoryRule {
  constructor(private readonly transactions: TransactionsRepository) {}

  execute(
    context: TenantContext,
    input: CreateTransactionCategoryRuleInput,
  ): Promise<CategoryRuleView> {
    assertTenantContext(context);

    return this.transactions.withTenant(context, async (scope) => {
      const category = await scope.categories.findById(input.categoryId);
      if (!category || category.tenantId !== context.tenantId) {
        throw new CategoryNotFound(
          'The category was not found for the authenticated tenant.',
        );
      }
      if (category.status === 'archived') {
        throw new CategoryArchived(
          'Archived categories cannot receive new rules.',
        );
      }

      const rule = CategoryRule.create({
        tenantId: context.tenantId,
        categoryId: category.id,
        conditionField: input.conditionField,
        conditionOperator: input.conditionOperator,
        conditionValue: input.conditionValue,
        priority: input.priority,
      });
      const snapshot = await scope.categoryRules.create(rule);
      return toCategoryRuleView(snapshot);
    });
  }
}
