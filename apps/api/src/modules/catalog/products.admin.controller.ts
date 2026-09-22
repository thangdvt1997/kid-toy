import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AdminProductDto, AdminVariantDto, CertificationDto } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpsertCertificationDto } from './dto/upsert-certification.dto';
import { ListProductsQuery, UpdateProductDto, UpsertProductDto } from './dto/upsert-product.dto';
import { UpdateVariantDto, UpsertVariantDto } from './dto/upsert-variant.dto';
import { ProductsService } from './products.service';

/**
 * Product/variant/certification admin surface (CATALOG-01, 03, 04, 05).
 * Copies the exact RBAC pattern documented in AdminProbeController:
 * class-level @UseGuards(JwtAuthGuard, RolesGuard) plus an explicit
 * @Roles('SUPER_ADMIN', 'CONTENT') on every route (T-01-33).
 */
@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class ProductsAdminController {
  constructor(private readonly products: ProductsService) {}

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('products')
  @ApiOperation({ summary: 'Create a bilingual product with facets' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async create(@Body() dto: UpsertProductDto): Promise<AdminProductDto> {
    return this.products.create(dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @Get('products')
  @ApiOperation({ summary: 'List products (paginated, optional name search)' })
  async list(
    @Query() query: ListProductsQuery,
  ): Promise<{ items: AdminProductDto[]; total: number }> {
    return this.products.list(query);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @Get('products/:id')
  @ApiOperation({ summary: 'Get a single product with variants, certifications and media' })
  async findOne(@Param('id') id: string): Promise<AdminProductDto> {
    return this.products.findOne(id);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.OK)
  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a product (partial per-locale translation updates allowed)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<AdminProductDto> {
    return this.products.update(id, dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('products/:id')
  @ApiOperation({ summary: 'Soft-delete a product (isActive = false)' })
  @ApiResponse({ status: 204, description: 'Soft-deleted' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.products.softDelete(id);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('products/:id/variants')
  @ApiOperation({ summary: 'Add a variant (SKU, barcode, carton spec) to a product' })
  async createVariant(
    @Param('id') productId: string,
    @Body() dto: UpsertVariantDto,
  ): Promise<AdminVariantDto> {
    return this.products.createVariant(productId, dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.OK)
  @Patch('variants/:variantId')
  @ApiOperation({ summary: 'Update a variant' })
  async updateVariant(
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<AdminVariantDto> {
    return this.products.updateVariant(variantId, dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('variants/:variantId/certifications')
  @ApiOperation({ summary: 'Record a QCVN safety certification against a variant' })
  async createCertification(
    @Param('variantId') variantId: string,
    @Body() dto: UpsertCertificationDto,
  ): Promise<CertificationDto> {
    return this.products.createCertification(variantId, dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('certifications/:certId')
  @ApiOperation({ summary: 'Delete a safety certification' })
  async deleteCertification(@Param('certId') certId: string): Promise<void> {
    await this.products.deleteCertification(certId);
  }
}
