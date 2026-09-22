import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PriceResolutionService,
  type ResolvedPrice,
} from '../pricing/price-resolution.service';
import { VariantStockService } from '../inventory/variant-stock.service';
import { MediaService } from './media.service';
import { PublicCatalogService } from './public-catalog.service';
import {
  bestStockStatus,
  toCatalogProductDetail,
  type PublicProductDetailRow,
} from './public-catalog.mapper';
import type { BrowseCatalogQuery } from './dto/browse-catalog.query';

const RETAIL_TIER = {
  id: 'tier-retail',
  code: 'RETAIL',
  name: 'Retail',
  isDefault: true,
};
const DEALER_A_TIER = {
  id: 'tier-dealer-a',
  code: 'DEALER_A',
  name: 'Dealer A',
  isDefault: false,
};

function baseQuery(
  overrides: Partial<BrowseCatalogQuery> = {},
): BrowseCatalogQuery {
  return {
    page: 1,
    pageSize: 24,
    sort: 'newest',
    ...overrides,
  };
}

/** Typed extraction of the `where` clause passed to the most recent product.findMany mock call. */
function lastFindManyWhere(mock: jest.Mock): Record<string, unknown> {
  const calls = mock.mock.calls as unknown as [
    { where: Record<string, unknown> },
  ][];
  const call = calls[0];
  if (!call) {
    throw new Error('product.findMany was never called');
  }
  return call[0].where;
}

function resolvedPrice(overrides: Partial<ResolvedPrice> = {}): ResolvedPrice {
  return {
    variantId: 'v1',
    tierId: RETAIL_TIER.id,
    tierCode: 'RETAIL',
    minQty: 1,
    unitPriceVnd: 100_000n,
    ...overrides,
  };
}

function makeProductRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    categoryId: 'cat-1',
    brandId: 'brand-1',
    ageRangeMin: 3,
    ageRangeMax: 6,
    gender: 'UNISEX',
    origin: 'VN',
    channelScope: 'BOTH',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    translations: [
      { locale: 'VI', name: 'San pham', slug: 'san-pham', description: null },
    ],
    brand: { id: 'brand-1', name: 'LEGO', originCountry: 'DK' },
    category: {
      id: 'cat-1',
      translations: [{ name: 'Danh muc', locale: 'VI' }],
    },
    variants: [
      {
        id: 'v1',
        sku: 'SKU-1',
        isActive: true,
        barcode: null,
        variantLabel: null,
      },
    ],
    media: [],
    ...overrides,
  };
}

describe('PublicCatalogService', () => {
  let service: PublicCatalogService;
  let prisma: {
    priceTier: { findFirstOrThrow: jest.Mock };
    product: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      groupBy: jest.Mock;
    };
    productTranslation: { findUnique: jest.Mock; findMany: jest.Mock };
    category: { findMany: jest.Mock };
    brand: { findMany: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let priceResolution: {
    resolveTierId: jest.Mock;
    resolveUnitPrices: jest.Mock;
    viewerFromJwt: jest.Mock;
  };
  let variantStock: { getAvailabilityMany: jest.Mock };
  let media: { getPresignedUrls: jest.Mock };

  beforeEach(async () => {
    prisma = {
      priceTier: { findFirstOrThrow: jest.fn().mockResolvedValue(RETAIL_TIER) },
      product: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      productTranslation: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      brand: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    priceResolution = {
      resolveTierId: jest.fn().mockResolvedValue(RETAIL_TIER.id),
      resolveUnitPrices: jest.fn().mockResolvedValue(new Map()),
      viewerFromJwt: jest.fn(),
    };
    variantStock = {
      getAvailabilityMany: jest.fn().mockResolvedValue(new Map()),
    };
    media = { getPresignedUrls: jest.fn().mockResolvedValue(new Map()) };

    const module = await Test.createTestingModule({
      providers: [
        PublicCatalogService,
        { provide: PrismaService, useValue: prisma },
        { provide: PriceResolutionService, useValue: priceResolution },
        { provide: VariantStockService, useValue: variantStock },
        { provide: MediaService, useValue: media },
      ],
    }).compile();

    service = module.get(PublicCatalogService);
  });

  // -----------------------------------------------------------------
  // Visibility matrix (channelScope x viewer tier) — allowedScopesFor,
  // exercised via browse()'s Prisma `where` clause.
  // -----------------------------------------------------------------
  describe('visibility (allowedScopesFor via browse)', () => {
    it('default (RETAIL) tier allows BOTH + RETAIL_ONLY, never WHOLESALE_ONLY', async () => {
      priceResolution.resolveTierId.mockResolvedValue(RETAIL_TIER.id);
      await service.browse(baseQuery(), {}, 'vi');
      const whereArg = lastFindManyWhere(prisma.product.findMany);
      expect(whereArg.channelScope).toEqual({ in: ['BOTH', 'RETAIL_ONLY'] });
    });

    it('a dealer tier allows BOTH + WHOLESALE_ONLY, never RETAIL_ONLY', async () => {
      priceResolution.resolveTierId.mockResolvedValue(DEALER_A_TIER.id);
      await service.browse(
        baseQuery(),
        { type: 'BUSINESS_ACCOUNT', accountId: 'biz-1' },
        'vi',
      );
      const whereArg = lastFindManyWhere(prisma.product.findMany);
      expect(whereArg.channelScope).toEqual({ in: ['BOTH', 'WHOLESALE_ONLY'] });
    });
  });

  // -----------------------------------------------------------------
  // Age-intersection predicate
  // -----------------------------------------------------------------
  describe('age filter (interval intersection, not equality)', () => {
    it('translates ageMin/ageMax into an intersection predicate', async () => {
      await service.browse(baseQuery({ ageMin: 0, ageMax: 3 }), {}, 'vi');
      const whereArg = lastFindManyWhere(prisma.product.findMany);
      expect(whereArg.ageRangeMin).toEqual({ lte: 3 });
      expect(whereArg.ageRangeMax).toEqual({ gte: 0 });
    });

    it('omits age predicates entirely when neither ageMin nor ageMax is supplied', async () => {
      await service.browse(baseQuery(), {}, 'vi');
      const whereArg = lastFindManyWhere(prisma.product.findMany);
      expect(whereArg.ageRangeMin).toBeUndefined();
      expect(whereArg.ageRangeMax).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  // Best-of stock reduction
  // -----------------------------------------------------------------
  describe('bestStockStatus', () => {
    it('IN_STOCK beats LOW_STOCK and OUT_OF_STOCK', () => {
      const map = new Map([
        ['v1', 'OUT_OF_STOCK' as const],
        ['v2', 'LOW_STOCK' as const],
        ['v3', 'IN_STOCK' as const],
      ]);
      expect(bestStockStatus(['v1', 'v2', 'v3'], map)).toBe('IN_STOCK');
    });

    it('LOW_STOCK beats OUT_OF_STOCK when nothing is IN_STOCK', () => {
      const map = new Map([
        ['v1', 'OUT_OF_STOCK' as const],
        ['v2', 'LOW_STOCK' as const],
      ]);
      expect(bestStockStatus(['v1', 'v2'], map)).toBe('LOW_STOCK');
    });

    it('defaults to OUT_OF_STOCK for a variant absent from the stock map', () => {
      expect(bestStockStatus(['v1'], new Map())).toBe('OUT_OF_STOCK');
    });
  });

  // -----------------------------------------------------------------
  // Query-count budget — 4 database calls per page, regardless of N
  // -----------------------------------------------------------------
  describe('query budget', () => {
    it('issues exactly 4 database calls for a 3-product page (count, products, price entries, stock)', async () => {
      prisma.product.findMany.mockResolvedValue([
        makeProductRow({ id: 'p1' }),
        makeProductRow({ id: 'p2' }),
        makeProductRow({ id: 'p3' }),
      ]);
      await service.browse(baseQuery(), {}, 'vi');

      expect(prisma.product.count).toHaveBeenCalledTimes(1);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
      expect(priceResolution.resolveUnitPrices).toHaveBeenCalledTimes(1);
      expect(variantStock.getAvailabilityMany).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------
  // findBySlug — cross-locale non-resolution, visibility, dealer pricing
  // -----------------------------------------------------------------
  describe('findBySlug', () => {
    it('throws NotFoundException without a cross-locale fallback lookup when the exact locale+slug row is absent', async () => {
      prisma.productTranslation.findUnique.mockResolvedValue(null);
      await expect(
        service.findBySlug('some-slug', 'en', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.productTranslation.findUnique).toHaveBeenCalledWith({
        where: { locale_slug: { locale: 'EN', slug: 'some-slug' } },
      });
      expect(prisma.product.findUnique).not.toHaveBeenCalled();
    });

    it('404s (not throws a different error) for an isActive=false product', async () => {
      prisma.productTranslation.findUnique.mockResolvedValue({
        productId: 'p1',
      });
      prisma.product.findUnique.mockResolvedValue(
        makeProductRow({ isActive: false }),
      );
      await expect(
        service.findBySlug('san-pham', 'vi', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a WHOLESALE_ONLY product for the default (RETAIL) tier', async () => {
      prisma.productTranslation.findUnique.mockResolvedValue({
        productId: 'p1',
      });
      prisma.product.findUnique.mockResolvedValue(
        makeProductRow({ channelScope: 'WHOLESALE_ONLY' }),
      );
      priceResolution.resolveTierId.mockResolvedValue(RETAIL_TIER.id);
      await expect(
        service.findBySlug('san-pham', 'vi', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves a per-variant price for every active variant for a dealer viewer', async () => {
      prisma.productTranslation.findUnique.mockResolvedValue({
        productId: 'p1',
      });
      prisma.product.findUnique.mockResolvedValue(
        makeProductRow({
          channelScope: 'BOTH',
          variants: [
            {
              id: 'v1',
              sku: 'SKU-1',
              isActive: true,
              barcode: null,
              variantLabel: null,
              certifications: [],
            },
            {
              id: 'v2',
              sku: 'SKU-2',
              isActive: true,
              barcode: null,
              variantLabel: null,
              certifications: [],
            },
          ],
        }),
      );
      priceResolution.resolveTierId.mockResolvedValue(DEALER_A_TIER.id);
      priceResolution.resolveUnitPrices.mockResolvedValue(
        new Map([
          [
            'v1',
            resolvedPrice({
              variantId: 'v1',
              tierId: DEALER_A_TIER.id,
              tierCode: 'DEALER_A',
              unitPriceVnd: 70_000n,
            }),
          ],
          [
            'v2',
            resolvedPrice({
              variantId: 'v2',
              tierId: DEALER_A_TIER.id,
              tierCode: 'DEALER_A',
              unitPriceVnd: 80_000n,
            }),
          ],
        ]),
      );

      const detail = await service.findBySlug('san-pham', 'vi', {
        type: 'BUSINESS_ACCOUNT',
        accountId: 'biz-1',
      });

      expect(detail.variants).toHaveLength(2);
      expect(
        detail.variants.every((v) => v.price?.tierCode === 'DEALER_A'),
      ).toBe(true);
      expect(
        detail.variants.find((v) => v.id === 'v1')?.price?.unitPriceVnd,
      ).toBe('70000');
      expect(
        detail.variants.find((v) => v.id === 'v2')?.price?.unitPriceVnd,
      ).toBe('80000');
    });
  });

  // -----------------------------------------------------------------
  // Translation fallback branches (Task 3 <behavior>)
  // -----------------------------------------------------------------
  describe('toCatalogProductDetail translation fallback', () => {
    const commonRow = {
      id: 'p1',
      categoryId: 'cat-1',
      brandId: null,
      ageRangeMin: 0,
      ageRangeMax: 3,
      gender: 'UNISEX' as const,
      origin: 'VN',
      brand: null,
      category: {
        id: 'cat-1',
        translations: [{ name: 'Danh muc', locale: 'VI' as const }],
      },
      variants: [],
      media: [],
    };

    it('null description branch: returns description: null and the requested locale name/slug without substituting the other locale', () => {
      const row = {
        ...commonRow,
        translations: [
          {
            locale: 'EN' as const,
            name: 'EN Name',
            slug: 'en-slug',
            description: null,
          },
          {
            locale: 'VI' as const,
            name: 'VI Name',
            slug: 'vi-slug',
            description: 'Mo ta VI',
          },
        ],
      };

      const dto = toCatalogProductDetail(
        row as unknown as PublicProductDetailRow,
        'en',
        new Map(),
        new Map(),
        new Map(),
      );
      expect(dto.name).toBe('EN Name');
      expect(dto.slug).toBe('en-slug');
      expect(dto.description).toBeNull();
      expect(dto.localeFallbackApplied).toBeUndefined();
    });

    it('absent translation row branch: falls back to the vi row and sets localeFallbackApplied: true', () => {
      const row = {
        ...commonRow,
        translations: [
          {
            locale: 'VI' as const,
            name: 'VI Name',
            slug: 'vi-slug',
            description: 'Mo ta VI',
          },
        ],
      };

      const dto = toCatalogProductDetail(
        row as unknown as PublicProductDetailRow,
        'en',
        new Map(),
        new Map(),
        new Map(),
      );
      expect(dto.name).toBe('VI Name');
      expect(dto.slug).toBe('vi-slug');
      expect(dto.localeFallbackApplied).toBe(true);
    });
  });
});
