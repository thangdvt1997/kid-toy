import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { PriceEntryDto, PriceTierDto } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpsertPriceEntryDto } from './dto/upsert-price-entry.dto';
import { UpsertPriceTierDto } from './dto/upsert-price-tier.dto';
import { PricingAdminService } from './pricing.admin.service';

/**
 * Price-tier and price-list-entry admin surface (CATALOG-06 write path).
 * Least-privilege RBAC per route (T-01-45): tier creation is SUPER_ADMIN
 * only, tier listing and price-entry management are SUPER_ADMIN or SALES.
 */
@ApiTags('admin-pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class PricingAdminController {
  constructor(private readonly pricing: PricingAdminService) {}

  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @Post('price-tiers')
  @ApiOperation({ summary: 'Create a price tier (isDefault is always false)' })
  @ApiResponse({ status: 201, description: 'Tier created' })
  async createTier(@Body() dto: UpsertPriceTierDto): Promise<PriceTierDto> {
    return this.pricing.createTier(dto);
  }

  @Roles('SUPER_ADMIN', 'SALES')
  @Get('price-tiers')
  @ApiOperation({ summary: 'List all price tiers' })
  async listTiers(): Promise<PriceTierDto[]> {
    return this.pricing.listTiers();
  }

  @Roles('SUPER_ADMIN', 'SALES')
  @Get('variants/:variantId/prices')
  @ApiOperation({ summary: "List a variant's price entries across every tier" })
  async listEntries(@Param('variantId') variantId: string): Promise<PriceEntryDto[]> {
    return this.pricing.listEntries(variantId);
  }

  @Roles('SUPER_ADMIN', 'SALES')
  @HttpCode(HttpStatus.OK)
  @Put('variants/:variantId/prices')
  @ApiOperation({ summary: 'Upsert a price entry on [variantId, tierId, minQty]' })
  async upsertEntry(
    @Param('variantId') variantId: string,
    @Body() dto: UpsertPriceEntryDto,
  ): Promise<PriceEntryDto> {
    return this.pricing.upsertEntry(variantId, dto);
  }

  @Roles('SUPER_ADMIN', 'SALES')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('price-entries/:entryId')
  @ApiOperation({ summary: 'Delete a price entry (refused for the last remaining retail price)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async deleteEntry(@Param('entryId') entryId: string): Promise<void> {
    await this.pricing.deleteEntry(entryId);
  }
}
