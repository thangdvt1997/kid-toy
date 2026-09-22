import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { MediaAdminController } from './media.admin.controller';
import { MediaService } from './media.service';
import { ProductsAdminController } from './products.admin.controller';
import { ProductsService } from './products.service';
import { TaxonomyAdminController } from './taxonomy.admin.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [TaxonomyAdminController, ProductsAdminController, MediaAdminController],
  providers: [TaxonomyService, ProductsService, MediaService],
  exports: [TaxonomyService, ProductsService, MediaService],
})
export class CatalogModule {}
