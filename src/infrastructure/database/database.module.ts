import { Global, Module } from '@nestjs/common';
import { DatabaseSecurityCheckService } from './database-security-check.service.js';
import { PrismaService } from './prisma.service.js';
import { PrismaTenantTransaction } from './prisma-tenant-transaction.js';
import { PrismaTenantUnitOfWork } from './prisma-tenant-unit-of-work.js';

@Global()
@Module({
  providers: [
    PrismaService,
    DatabaseSecurityCheckService,
    PrismaTenantTransaction,
    PrismaTenantUnitOfWork,
  ],
  exports: [
    PrismaService,
    DatabaseSecurityCheckService,
    PrismaTenantTransaction,
    PrismaTenantUnitOfWork,
  ],
})
export class DatabaseModule {}
