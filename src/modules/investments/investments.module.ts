import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { InvestmentController } from './adapters/inbound/investment.controller.js';
import { PrismaInvestmentReadRepository } from './adapters/outbound/prisma-investment-read.repository.js';
import { InvestmentReadService } from './application/investment-read.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [InvestmentController],
  providers: [
    PrismaInvestmentReadRepository,
    {
      provide: InvestmentReadService,
      useFactory: (repository: PrismaInvestmentReadRepository) =>
        new InvestmentReadService(repository),
      inject: [PrismaInvestmentReadRepository],
    },
  ],
})
export class InvestmentsModule {}
