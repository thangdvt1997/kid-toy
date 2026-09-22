import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PriceResolutionService } from './price-resolution.service';
import { PricingAdminController } from './pricing.admin.controller';
import { PricingAdminService } from './pricing.admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [PricingAdminController],
  providers: [PriceResolutionService, PricingAdminService],
  exports: [PriceResolutionService],
})
export class PricingModule {}
