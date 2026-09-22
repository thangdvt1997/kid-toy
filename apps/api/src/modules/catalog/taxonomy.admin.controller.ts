import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { BrandDto, CategoryDto } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateBrandDto, UpsertBrandDto } from './dto/upsert-brand.dto';
import { UpdateCategoryDto, UpsertCategoryDto } from './dto/upsert-category.dto';
import { TaxonomyService } from './taxonomy.service';

/**
 * Bilingual category and brand management (CATALOG-09 write path). Copies
 * the exact RBAC pattern documented in AdminProbeController: class-level
 * @UseGuards(JwtAuthGuard, RolesGuard) (authentication first, then
 * authorization) plus an explicit @Roles(...) on every route — T-01-33.
 */
@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class TaxonomyAdminController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('categories')
  @ApiOperation({ summary: 'Create a bilingual category' })
  @ApiResponse({ status: 201, description: 'Category created with vi + en translations' })
  @ApiResponse({ status: 400, description: 'BOTH_LOCALES_REQUIRED or PARENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'SLUG_TAKEN (per-locale)' })
  async createCategory(@Body() dto: UpsertCategoryDto): Promise<CategoryDto> {
    return this.taxonomy.createCategory(dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @Get('categories')
  @ApiOperation({ summary: 'List every category with vi + en translations' })
  @ApiResponse({ status: 200, description: 'Flat category list, parentId included' })
  async listCategories(): Promise<CategoryDto[]> {
    return this.taxonomy.listCategories();
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.OK)
  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category (partial per-locale translation updates allowed)' })
  @ApiResponse({ status: 200, description: 'Updated category' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return this.taxonomy.updateCategory(id, dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('brands')
  @ApiOperation({ summary: 'Create a brand' })
  @ApiResponse({ status: 201, description: 'Brand created' })
  @ApiResponse({ status: 409, description: 'BRAND_NAME_TAKEN' })
  async createBrand(@Body() dto: UpsertBrandDto): Promise<BrandDto> {
    return this.taxonomy.createBrand(dto);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @Get('brands')
  @ApiOperation({ summary: 'List every brand' })
  async listBrands(): Promise<BrandDto[]> {
    return this.taxonomy.listBrands();
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.OK)
  @Patch('brands/:id')
  @ApiOperation({ summary: 'Update a brand' })
  async updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandDto): Promise<BrandDto> {
    return this.taxonomy.updateBrand(id, dto);
  }
}
