import { Module } from '@nestjs/common';
import { PrismaPatrimonyRepository } from './adapters/outbound/prisma-patrimony.repository.js';
import { PatrimonyController } from './adapters/inbound/patrimony.controller.js';
import { PatrimonyService } from './application/patrimony.service.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [IdentityModule],
  controllers: [PatrimonyController],
  providers: [
    PrismaPatrimonyRepository,
    {
      provide: PatrimonyService,
      useFactory: (repository: PrismaPatrimonyRepository) =>
        new PatrimonyService(repository),
      inject: [PrismaPatrimonyRepository],
    },
  ],
})
export class PatrimonyModule {}
