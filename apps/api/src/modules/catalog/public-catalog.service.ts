import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AgeBucket,
  CatalogListItem,
  CatalogProductDetail,
  FacetOption,
} from '@kid-toy/shared-types';
import {
  Prisma,
  type ChannelScope,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toPrismaLocale,
  type AppLocale,
} from '../../common/decorators/request-locale.decorator';
import {
  PriceResolutionService,
  type Viewer,
} from '../pricing/price-resolution.service';
import { VariantStockService } from '../inventory/variant-stock.service';
import { MediaService } from './media.service';
import type { BrowseCatalogQuery } from './dto/browse-catalog.query';
import {
  toCatalogListItem,
  toCatalogProductDetail,
  type PublicProductListRow,
} from './public-catalog.mapper';

export interface BrowseResult {
  items: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FacetsResult {
  categories: FacetOption[];
  brands: FacetOption[];
  origins: FacetOption[];
  ageBuckets: AgeBucket[];
}

const AGE_BUCKET_DEFS: { label: string; min: number; max: number }[] = [
  { label: '0-2', min: 0, max: 2 },
  { label: '3-5', min: 3, max: 5 },
  { label: '6-8', min: 6, max: 8 },
  { label: '9-12', min: 9, max: 12 },
  { label: '13+', min: 13, max: 18 },
];

/** Vietnamese base letters with NO Unicode NFD decomposition (đ/ơ/ư) — everything else (ăâêô and all tone marks) decomposes cleanly via NFD. */
const ATOMIC_VI_MAP: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
  ơ: 'o',
  Ơ: 'O',
  ư: 'u',
  Ư: 'U',
};

function stripDiacritics(value: string): string {
  const withAtomicMapped = value.replace(
    /[đĐơƠưƯ]/g,
    (ch) => ATOMIC_VI_MAP[ch] ?? ch,
  );
  return withAtomicMapped.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const PUBLIC_PRODUCT_INCLUDE = (prismaLocale: 'VI' | 'EN') =>
  ({
    translations: { where: { locale: prismaLocale } },
    brand: true,
    category: {
      include: { translations: { where: { locale: prismaLocale } } },
    },
    variants: { where: { isActive: true }, orderBy: { sku: 'asc' } },
    media: { orderBy: { sortOrder: 'asc' }, take: 1 },
  }) satisfies Prisma.ProductInclude;

const PUBLIC_PRODUCT_DETAIL_INCLUDE = (prismaLocale: 'VI' | 'EN') =>
  ({
    translations: true, // BOTH locales — needed for the explicit fallback rule
    brand: true,
    category: {
      include: { translations: { where: { locale: prismaLocale } } },
    },
    media: { orderBy: { sortOrder: 'asc' } },
    variants: {
      where: { isActive: true },
      orderBy: { sku: 'asc' },
      include: { certifications: true },
    },
  }) satisfies Prisma.ProductInclude;

/**
 * Anonymous-tolerant, viewer-aware, locale-aware catalog read path
 * (CATALOG-06/07/08/09). One code path serves anonymous shoppers, retail
 * customers and approved dealers alike — see ARCHITECTURE.md: two
 * channel-specific catalog endpoints would be the duplicated-catalog
 * anti-pattern. Never computes a price itself — always defers to
 * PriceResolutionService (T-01-50).
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceResolution: PriceResolutionService,
    private readonly variantStock: VariantStockService,
    private readonly media: MediaService,
  ) {}

  /**
   * Derives the permitted `channelScope` set from the viewer's resolved
   * tier: the default (RETAIL) tier sees BOTH + RETAIL_ONLY; any dealer
   * tier sees BOTH + WHOLESALE_ONLY. Shared by `browse` and `findBySlug`
   * so the two endpoints cannot drift apart (T-01-51). Re-resolves the
   * tier from the database every call via PriceResolutionService — never
   * trusts a stale JWT (T-01-54).
   */
  private async allowedScopesFor(viewer: Viewer): Promise<ChannelScope[]> {
    const [tierId, defaultTier] = await Promise.all([
      this.priceResolution.resolveTierId(viewer),
      this.prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } }),
    ]);
    return tierId === defaultTier.id
      ? ['BOTH', 'RETAIL_ONLY']
      : ['BOTH', 'WHOLESALE_ONLY'];
  }

  /**
   * Finds product ids whose current-locale translated name matches
   * `search`, case- and diacritic-insensitively. Uses Postgres's
   * `unaccent` extension (enabled by migration
   * 20260922100000_enable_unaccent_extension) plus an explicit
   * đ/ơ/ư translate() — those three Vietnamese base letters have no
   * Unicode decomposition, so `unaccent` alone would not fold them. Falls
   * back to a plain (documented, imperfect) ILIKE match against both the
   * raw and diacritic-stripped term if the extension is unavailable in a
   * given environment.
   */
  private async matchingProductIdsForSearch(
    search: string,
    prismaLocale: 'VI' | 'EN',
  ): Promise<string[]> {
    const term = search.trim();
    if (!term) {
      return [];
    }
    const pattern = `%${term}%`;
    try {
      const rows = await this.prisma.$queryRaw<
        { productId: string }[]
      >(Prisma.sql`
        SELECT "productId" FROM "product_translations"
        WHERE "locale" = ${prismaLocale}::"Locale"
          AND unaccent(translate("name", 'đĐơƠưƯ', 'dDoOuU'))
              ILIKE unaccent(translate(${pattern}, 'đĐơƠưƯ', 'dDoOuU'))
      `);
      return rows.map((r) => r.productId);
    } catch {
      const normalizedPattern = `%${stripDiacritics(term)}%`;
      const rows = await this.prisma.$queryRaw<
        { productId: string }[]
      >(Prisma.sql`
        SELECT "productId" FROM "product_translations"
        WHERE "locale" = ${prismaLocale}::"Locale"
          AND ("name" ILIKE ${pattern} OR "name" ILIKE ${normalizedPattern})
      `);
      return rows.map((r) => r.productId);
    }
  }

  private buildWhere(
    query: BrowseCatalogQuery,
    allowedScopes: ChannelScope[],
    searchProductIds: string[] | undefined,
  ): Prisma.ProductWhereInput {
    return {
      isActive: true,
      channelScope: { in: allowedScopes },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      // Interval intersection, not equality — a product matches when its
      // [ageRangeMin, ageRangeMax] intersects the requested [ageMin, ageMax].
      ...(query.ageMax !== undefined
        ? { ageRangeMin: { lte: query.ageMax } }
        : {}),
      ...(query.ageMin !== undefined
        ? { ageRangeMax: { gte: query.ageMin } }
        : {}),
      ...(searchProductIds ? { id: { in: searchProductIds } } : {}),
    };
  }

  async browse(
    query: BrowseCatalogQuery,
    viewer: Viewer,
    locale: AppLocale,
  ): Promise<BrowseResult> {
    const prismaLocale = toPrismaLocale(locale);
    const allowedScopes = await this.allowedScopesFor(viewer);

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 24, 60);

    const searchProductIds = query.search
      ? await this.matchingProductIdsForSearch(query.search, prismaLocale)
      : undefined;

    const where = this.buildWhere(query, allowedScopes, searchProductIds);
    const isNameSort = query.sort === 'name_asc' || query.sort === 'name_desc';

    let pageIds: string[] | undefined;
    if (isNameSort) {
      const ordered = await this.prisma.productTranslation.findMany({
        where: { locale: prismaLocale, product: where },
        select: { productId: true },
        orderBy: { name: query.sort === 'name_asc' ? 'asc' : 'desc' },
      });
      const allIds = ordered.map((o) => o.productId);
      pageIds = allIds.slice(
        (page - 1) * pageSize,
        (page - 1) * pageSize + pageSize,
      );
    }

    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where: pageIds ? { ...where, id: { in: pageIds } } : where,
        include: PUBLIC_PRODUCT_INCLUDE(prismaLocale),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(pageIds ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
      }),
    ]);

    let orderedProducts = products as PublicProductListRow[];
    if (pageIds) {
      const byId = new Map(orderedProducts.map((p) => [p.id, p]));
      orderedProducts = pageIds
        .map((id) => byId.get(id))
        .filter((p): p is PublicProductListRow => Boolean(p));
    }

    const variantIds = orderedProducts.flatMap((p) =>
      p.variants.map((v) => v.id),
    );
    const [priceMap, stockMap] = await Promise.all([
      this.priceResolution.resolveUnitPrices(variantIds, viewer),
      this.variantStock.getAvailabilityMany(variantIds),
    ]);
    const mediaRows = orderedProducts
      .map((p) => p.media[0])
      .filter((m): m is NonNullable<typeof m> => Boolean(m));
    const urlMap = await this.media.getPresignedUrls(mediaRows);

    const items = orderedProducts.map((p) =>
      toCatalogListItem(p, locale, priceMap, stockMap, urlMap),
    );
    return { items, total, page, pageSize };
  }

  async findBySlug(
    slug: string,
    locale: AppLocale,
    viewer: Viewer,
  ): Promise<CatalogProductDetail> {
    const prismaLocale = toPrismaLocale(locale);

    // Per-locale slug lookup ONLY — never attempt a cross-locale slug
    // resolution (T-01-52 / CATALOG-09 slug-uniqueness contract).
    const translationRow = await this.prisma.productTranslation.findUnique({
      where: { locale_slug: { locale: prismaLocale, slug } },
    });
    if (!translationRow) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: translationRow.productId },
      include: PUBLIC_PRODUCT_DETAIL_INCLUDE(prismaLocale),
    });
    // 404, never 403 — existence of an inactive/out-of-scope product is
    // never confirmed to an unauthorized viewer (T-01-52).
    if (!product || !product.isActive) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }

    const allowedScopes = await this.allowedScopesFor(viewer);
    if (!allowedScopes.includes(product.channelScope)) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }

    const detailProduct = product;
    const variantIds = detailProduct.variants.map((v) => v.id);
    const [priceMap, stockMap] = await Promise.all([
      this.priceResolution.resolveUnitPrices(variantIds, viewer),
      this.variantStock.getAvailabilityMany(variantIds),
    ]);
    const urlMap = await this.media.getPresignedUrls(detailProduct.media);

    return toCatalogProductDetail(
      detailProduct,
      locale,
      priceMap,
      stockMap,
      urlMap,
    );
  }

  async facets(locale: AppLocale, viewer: Viewer): Promise<FacetsResult> {
    const prismaLocale = toPrismaLocale(locale);
    const allowedScopes = await this.allowedScopesFor(viewer);
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      channelScope: { in: allowedScopes },
    };

    const [categoryGroups, brandGroups, originGroups, ageCounts] =
      await Promise.all([
        this.prisma.product.groupBy({
          by: ['categoryId'],
          where,
          _count: { _all: true },
        }),
        this.prisma.product.groupBy({
          by: ['brandId'],
          where,
          _count: { _all: true },
        }),
        this.prisma.product.groupBy({
          by: ['origin'],
          where,
          _count: { _all: true },
        }),
        Promise.all(
          AGE_BUCKET_DEFS.map(async (bucket) => ({
            bucket,
            count: await this.prisma.product.count({
              where: {
                ...where,
                ageRangeMin: { lte: bucket.max },
                ageRangeMax: { gte: bucket.min },
              },
            }),
          })),
        ),
      ]);

    const categoryIds = categoryGroups.map((g) => g.categoryId);
    const categories = categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: categoryIds } },
          include: { translations: { where: { locale: prismaLocale } } },
        })
      : [];
    const categoryNameById = new Map(
      categories.map((c) => [c.id, c.translations[0]?.name ?? c.id]),
    );

    const brandIds = brandGroups
      .map((g) => g.brandId)
      .filter((id): id is string => id !== null);
    const brands = brandIds.length
      ? await this.prisma.brand.findMany({ where: { id: { in: brandIds } } })
      : [];
    const brandNameById = new Map(brands.map((b) => [b.id, b.name]));

    return {
      categories: categoryGroups.map((g) => ({
        value: g.categoryId,
        label: categoryNameById.get(g.categoryId) ?? g.categoryId,
        count: g._count._all,
      })),
      brands: brandGroups
        .filter((g): g is typeof g & { brandId: string } => g.brandId !== null)
        .map((g) => ({
          value: g.brandId,
          label: brandNameById.get(g.brandId) ?? g.brandId,
          count: g._count._all,
        })),
      origins: originGroups.map((g) => ({
        value: g.origin,
        label: g.origin,
        count: g._count._all,
      })),
      ageBuckets: ageCounts.map(({ bucket, count }) => ({
        label: bucket.label,
        min: bucket.min,
        max: bucket.max,
        count,
      })),
    };
  }
}
