import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PriceResolutionService } from './price-resolution.service';

@Module({
  imports: [PrismaModule],
  providers: [PriceResolutionService],
  exports: [PriceResolutionService],
})
export class PricingModule {}
