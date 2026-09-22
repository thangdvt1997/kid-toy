import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { TaxonomyAdminController } from './taxonomy.admin.controller';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [TaxonomyAdminController],
  providers: [TaxonomyService],
  exports: [TaxonomyService],
})
export class CatalogModule {}
