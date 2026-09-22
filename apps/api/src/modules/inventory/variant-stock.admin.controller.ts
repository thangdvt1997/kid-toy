import { Body, Controller, HttpCode, HttpStatus, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { VariantStockDto } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SetVariantStockDto } from './dto/set-variant-stock.dto';
import { VariantStockService } from './variant-stock.service';

/**
 * Variant stock administration surface (CATALOG-08 write path). Copies the
 * class-level UseGuards(JwtAuthGuard, RolesGuard) + per-route
 * Roles(...) RBAC pattern used across every other admin controller in this
 * codebase — WAREHOUSE staff (and SUPER_ADMIN) only, least privilege.
 */
@ApiTags('admin-inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/variants')
export class VariantStockAdminController {
  constructor(private readonly variantStock: VariantStockService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE')
  @HttpCode(HttpStatus.OK)
  @Put(':variantId/stock')
  @ApiOperation({ summary: "Set a variant's on-hand quantity and reorder threshold" })
  @ApiResponse({ status: 200, description: 'Stock upserted; response reflects the derived status' })
  async setStock(
    @Param('variantId') variantId: string,
    @Body() dto: SetVariantStockDto,
  ): Promise<VariantStockDto> {
    return this.variantStock.setStock(variantId, dto.quantityOnHand, dto.reorderThreshold);
  }
}
