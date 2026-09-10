import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { IdentityContextUnavailable } from '../../domain/identity.errors.js';

export type TenantContextRequest = Request & {
  tenantContext?: TenantContext;
};

export const CurrentTenantContext = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): TenantContext => {
    const request = executionContext
      .switchToHttp()
      .getRequest<TenantContextRequest>();
    if (!request.tenantContext) {
      throw new IdentityContextUnavailable(
        'Authenticated request has no tenant context.',
      );
    }
    return request.tenantContext;
  },
);
