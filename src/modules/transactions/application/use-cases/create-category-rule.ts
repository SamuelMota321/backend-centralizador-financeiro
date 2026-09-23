import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { CategoryRule } from '../../domain/category-rule.js';
import { CategoryArchived, CategoryNotFound } from '../transactions.errors.js';
import {
  toCategoryRuleView,
  type CategoryRuleView,
} from '../transactions-view.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';

export type CreateTransactionCategoryRuleInput = Readonly<{
  categoryId: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  priority: number;
}>;

export class CreateCategoryRule {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly accountState?: TransactionAccountStateReader,
  ) {}

  async execute(
    context: TenantContext,
    input: CreateTransactionCategoryRuleInput,
    requestId: string = randomUUID(),
  ): Promise<CategoryRuleView> {
    assertTenantContext(context);

    const rule = CategoryRule.create({
      tenantId: context.tenantId,
      categoryId: input.categoryId,
      conditionField: input.conditionField,
      conditionOperator: input.conditionOperator,
      conditionValue: input.conditionValue,
      priority: input.priority,
    });
    if (rule.props.conditionField === 'accountId' && this.accountState) {
      const accountState = await this.accountState.getOwnedState(
        context,
        rule.props.conditionValue,
      );
      if (accountState === 'missing') {
        throw new CategoryNotFound(
          'The account was not found for the authenticated tenant.',
        );
      }
    }

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

      const snapshot = await scope.categoryRules.create(rule);
      await scope.audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'category_rule_created',
          resourceType: 'category_rule',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: {
            changedFields: [
              'categoryId',
              'conditionField',
              'conditionOperator',
              'conditionValue',
              'priority',
            ],
          },
        }),
      );
      return toCategoryRuleView(snapshot);
    });
  }
}
