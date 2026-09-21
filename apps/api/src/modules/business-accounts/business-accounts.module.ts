import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { BusinessAccountsAdminController } from './business-accounts.admin.controller';
import { BusinessAccountsController } from './business-accounts.controller';
import { BusinessAccountsService } from './business-accounts.service';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule],
  controllers: [BusinessAccountsController, BusinessAccountsAdminController],
  providers: [BusinessAccountsService],
  exports: [BusinessAccountsService],
})
export class BusinessAccountsModule {}
