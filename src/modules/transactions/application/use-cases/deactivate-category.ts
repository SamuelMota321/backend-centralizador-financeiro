import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { Category } from '../../domain/category.js';
import { CategoryNotFound } from '../transactions.errors.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import { toCategoryView, type CategoryView } from '../transactions-view.js';

export class DeactivateCategory {
  constructor(private readonly unitOfWork: TransactionsUnitOfWork) {}

  async execute(
    context: TenantContext,
    categoryId: string,
    requestId: string = randomUUID(),
  ): Promise<CategoryView> {
    assertTenantContext(context);
    return this.unitOfWork.run(context, async ({ categories, audit }) => {
      const current = await categories.findByIdForUpdate(categoryId);
      if (!current || current.tenantId !== context.tenantId) {
        throw new CategoryNotFound(
          'The category was not found for the authenticated tenant.',
        );
      }
      const category = Category.reconstitute(current);
      const wasArchived = category.props.status === 'archived';
      const updated = category.archive(new Date().toISOString());
      const snapshot = await categories.update(updated);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'category_archived',
          resourceType: 'category',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: {
            stateTransition: wasArchived
              ? 'already_archived'
              : 'active_to_archived',
          },
        }),
      );
      return toCategoryView(snapshot);
    });
  }
}
