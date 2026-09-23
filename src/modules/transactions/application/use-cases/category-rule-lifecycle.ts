import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { CategoryRule } from '../../domain/category-rule.js';
import { CategoryRuleNotFound } from '../../domain/transactions.errors.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import {
  toCategoryRuleView,
  type CategoryRuleView,
} from '../transactions-view.js';

export type CategoryRuleLifecycleAction = 'activate' | 'deactivate' | 'remove';

export class CategoryRuleLifecycle {
  constructor(private readonly unitOfWork: TransactionsUnitOfWork) {}

  async execute(
    context: TenantContext,
    ruleId: string,
    action: CategoryRuleLifecycleAction,
    requestId: string = randomUUID(),
  ): Promise<CategoryRuleView> {
    assertTenantContext(context);
    return this.unitOfWork.run(context, async ({ categoryRules, audit }) => {
      const current = await categoryRules.findByIdForUpdate(ruleId);
      if (!current || current.tenantId !== context.tenantId) {
        throw new CategoryRuleNotFound(
          'The category rule was not found for the authenticated tenant.',
        );
      }
      const rule = CategoryRule.reconstitute(current);
      const updated =
        action === 'activate'
          ? rule.activate(new Date().toISOString())
          : action === 'deactivate'
            ? rule.deactivate(new Date().toISOString())
            : rule.remove(new Date().toISOString());
      const snapshot = await categoryRules.update(updated);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action:
            action === 'activate'
              ? 'category_rule_activated'
              : action === 'deactivate'
                ? 'category_rule_deactivated'
                : 'category_rule_removed',
          resourceType: 'category_rule',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: { changedFields: ['status'] },
        }),
      );
      return toCategoryRuleView(snapshot);
    });
  }
}
