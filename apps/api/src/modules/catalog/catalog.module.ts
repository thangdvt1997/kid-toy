import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VariantStockModule } from '../inventory/variant-stock.module';
import { PricingModule } from '../pricing/pricing.module';
import { StorageModule } from '../storage/storage.module';
import { MediaAdminController } from './media.admin.controller';
import { MediaService } from './media.service';
import { ProductsAdminController } from './products.admin.controller';
import { ProductsService } from './products.service';
import { PublicCatalogController } from './public-catalog.controller';
import { PublicCatalogService } from './public-catalog.service';
import { TaxonomyAdminController } from './taxonomy.admin.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [PrismaModule, StorageModule, PricingModule, VariantStockModule],
  controllers: [
    TaxonomyAdminController,
    ProductsAdminController,
    MediaAdminController,
    PublicCatalogController,
  ],
  providers: [
    TaxonomyService,
    ProductsService,
    MediaService,
    PublicCatalogService,
  ],
  exports: [
    TaxonomyService,
    ProductsService,
    MediaService,
    PublicCatalogService,
  ],
})
export class CatalogModule {}
