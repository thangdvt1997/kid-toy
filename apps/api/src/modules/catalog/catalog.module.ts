import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ProductsAdminController } from './products.admin.controller';
import { ProductsService } from './products.service';
import { TaxonomyAdminController } from './taxonomy.admin.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [TaxonomyAdminController, ProductsAdminController],
  providers: [TaxonomyService, ProductsService],
  exports: [TaxonomyService, ProductsService],
})
export class CatalogModule {}
