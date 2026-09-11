import type { TenantContext } from '../tenant-context.js';

export const TENANT_UNIT_OF_WORK = Symbol('TENANT_UNIT_OF_WORK');

export interface TenantUnitOfWork<Scope> {
  run<Result>(
    context: TenantContext,
    operation: (scope: Scope) => Promise<Result>,
  ): Promise<Result>;
}
