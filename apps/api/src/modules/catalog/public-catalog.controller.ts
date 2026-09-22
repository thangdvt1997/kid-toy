import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CatalogProductDetail } from '@kid-toy/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequestLocale,
  type AppLocale,
} from '../../common/decorators/request-locale.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { PriceResolutionService } from '../pricing/price-resolution.service';
import { BrowseCatalogQuery } from './dto/browse-catalog.query';
import {
  PublicCatalogService,
  type BrowseResult,
  type FacetsResult,
} from './public-catalog.service';

/**
 * The ONE public catalog surface — anonymous shoppers, retail customers and
 * approved dealers all hit these exact routes; OptionalJwtAuthGuard never
 * 401s a missing/invalid token (CATALOG-06). Never two channel-specific
 * catalog endpoints — see ARCHITECTURE.md anti-pattern discussion in
 * 01-07-PLAN.md <objective>.
 */
@ApiTags('catalog')
@Controller('catalog')
export class PublicCatalogController {
  constructor(
    private readonly catalog: PublicCatalogService,
    private readonly priceResolution: PriceResolutionService,
  ) {}

  @Get('products')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Browse the public catalog',
    description:
      'Bearer token is optional. The returned price varies by viewer: retail for anonymous/retail viewers, tier-resolved wholesale for an approved dealer.',
  })
  async browse(
    @Query() query: BrowseCatalogQuery,
    @RequestLocale() locale: AppLocale,
    @CurrentUser() user?: JwtPayload,
  ): Promise<BrowseResult> {
    const viewer = this.priceResolution.viewerFromJwt(user);
    return this.catalog.browse(query, viewer, locale);
  }

  @Get('facets')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Facet counts for the current viewer/locale',
    description:
      'Counts always agree with what clicking that facet on /catalog/products will return for the same viewer.',
  })
  async facets(
    @RequestLocale() locale: AppLocale,
    @CurrentUser() user?: JwtPayload,
  ): Promise<FacetsResult> {
    const viewer = this.priceResolution.viewerFromJwt(user);
    return this.catalog.facets(locale, viewer);
  }

  // Declared AFTER `products` and `facets` so neither literal segment is
  // ever captured by this `:slug` parameter (T-01-58).
  @Get('products/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Product detail by per-locale slug',
    description:
      'Bearer token is optional. Slugs are per-locale and never cross-resolve; 404 (not 403) for an out-of-scope, inactive, or non-existent product.',
  })
  async findBySlug(
    @Param('slug') slug: string,
    @RequestLocale() locale: AppLocale,
    @CurrentUser() user?: JwtPayload,
  ): Promise<CatalogProductDetail> {
    const viewer = this.priceResolution.viewerFromJwt(user);
    return this.catalog.findBySlug(slug, locale, viewer);
  }
}
