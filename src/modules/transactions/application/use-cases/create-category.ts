import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
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
    requestId: string = randomUUID(),
  ): Promise<CategoryView> {
    assertTenantContext(context);
    const category = Category.create({
      tenantId: context.tenantId,
      name: input.name,
    });

    return this.transactions.withTenant(context, async (scope) => {
      const repository: TenantCategoriesRepository = scope.categories;
      const snapshot = await repository.create(category);
      await scope.audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'category_created',
          resourceType: 'category',
          resourceId: snapshot.id,
          outcome: 'success',
          requestId,
          metadata: { changedFields: ['name'] },
        }),
      );
      return toCategoryView(snapshot);
    });
  }
}
