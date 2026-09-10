import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  assertTenantContext,
  type TenantContext,
} from '../../shared/application/tenant-context.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaTenantTransaction {
  constructor(private readonly prisma: PrismaService) {}

  async run<Result>(
    context: TenantContext,
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    assertTenantContext(context);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.current_tenant_id', ${context.tenantId}, true)
      `;
      return operation(transaction);
    });
  }
}
