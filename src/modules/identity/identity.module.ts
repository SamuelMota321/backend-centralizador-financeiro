import { Module } from '@nestjs/common';
import { PrismaIdentityContextResolver } from './adapters/outbound/prisma-identity-context-resolver.js';

@Module({
  providers: [PrismaIdentityContextResolver],
  exports: [PrismaIdentityContextResolver],
})
export class IdentityModule {}
