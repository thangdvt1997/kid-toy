import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VariantStockAdminController } from './variant-stock.admin.controller';
import { VariantStockService } from './variant-stock.service';

@Module({
  imports: [PrismaModule],
  controllers: [VariantStockAdminController],
  providers: [VariantStockService],
  exports: [VariantStockService],
})
export class VariantStockModule {}
