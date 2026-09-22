import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { AdminProbeController } from './modules/admin/admin-probe.controller';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessAccountsModule } from './modules/business-accounts/business-accounts.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { VariantStockModule } from './modules/inventory/variant-stock.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { StorageModule } from './modules/storage/storage.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    AuthModule,
    BusinessAccountsModule,
    CatalogModule,
    PricingModule,
    VariantStockModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
  ],
  controllers: [HealthController, AdminProbeController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
