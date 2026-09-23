import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import {
  AuditRecord,
  type AuditChangedField,
} from '../../../audit/application/audit-record.js';
import { CategoryRule, type UpdateCategoryRuleInput } from '../../domain/category-rule.js';
import { CategoryRuleNotFound } from '../../domain/transactions.errors.js';
import {
  CategoryArchived,
  CategoryNotFound,
  TransactionAccountNotFound,
} from '../transactions.errors.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import {
  toCategoryRuleView,
  type CategoryRuleView,
} from '../transactions-view.js';

export class UpdateCategoryRule {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly unitOfWork: TransactionsUnitOfWork,
    private readonly accountState?: TransactionAccountStateReader,
  ) {}

  async execute(
    context: TenantContext,
    ruleId: string,
    requestId: string = randomUUID(),
    input: UpdateCategoryRuleInput,
  ): Promise<CategoryRuleView> {
    assertTenantContext(context);
    const current = await this.transactions.withTenant(
      context,
      ({ categoryRules }) => categoryRules.findById(ruleId),
    );
    if (!current || current.tenantId !== context.tenantId) {
      throw new CategoryRuleNotFound(
        'The category rule was not found for the authenticated tenant.',
      );
    }

    const preview = CategoryRule.reconstitute(current).update(
      input,
      new Date().toISOString(),
    );
    const nextField = preview.props.conditionField;
    const nextValue = preview.props.conditionValue;
    if (nextField === 'accountId' && this.accountState) {
      const state = await this.accountState.getOwnedState(
        context,
        nextValue.toLowerCase(),
      );
      if (state === 'missing') throw new TransactionAccountNotFound();
    }

    return this.unitOfWork.run(context, async ({ categoryRules, categories, audit }) => {
      const locked = await categoryRules.findByIdForUpdate(ruleId);
      if (!locked || locked.tenantId !== context.tenantId) {
        throw new CategoryRuleNotFound(
          'The category rule was not found for the authenticated tenant.',
        );
      }
      const rule = CategoryRule.reconstitute(locked);
      const categoryId = input.categoryId ?? rule.props.categoryId;
      if (input.categoryId) {
        const category = await categories.findById(categoryId);
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
      }

      const updated = rule.update(input, new Date().toISOString());
      const snapshot = await categoryRules.update(updated);
      const changedFields = ruleChangedFields(input);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'category_rule_updated',
          resourceType: 'category_rule',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: { changedFields },
        }),
      );
      return toCategoryRuleView(snapshot);
    });
  }
}

function ruleChangedFields(
  input: UpdateCategoryRuleInput,
): AuditChangedField[] {
  const fields: Array<[
    keyof UpdateCategoryRuleInput,
    AuditChangedField,
  ]> = [
    ['categoryId', 'categoryId'],
    ['conditionField', 'conditionField'],
    ['conditionOperator', 'conditionOperator'],
    ['conditionValue', 'conditionValue'],
    ['priority', 'priority'],
  ];
  return fields
    .filter(([key]) => Object.prototype.hasOwnProperty.call(input, key))
    .map(([, field]) => field);
}
