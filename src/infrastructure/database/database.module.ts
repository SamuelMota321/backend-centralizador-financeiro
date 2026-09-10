import { Global, Module } from '@nestjs/common';
import { DatabaseSecurityCheckService } from './database-security-check.service.js';
import { PrismaService } from './prisma.service.js';
import { PrismaTenantTransaction } from './prisma-tenant-transaction.js';

@Global()
@Module({
  providers: [
    PrismaService,
    DatabaseSecurityCheckService,
    PrismaTenantTransaction,
  ],
  exports: [
    PrismaService,
    DatabaseSecurityCheckService,
    PrismaTenantTransaction,
  ],
})
export class DatabaseModule {}
