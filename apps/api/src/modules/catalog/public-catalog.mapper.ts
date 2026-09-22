import type {
  CatalogListItem,
  CatalogPrice,
  CatalogProductDetail,
  CatalogVariantSummary,
  StockStatus,
} from '@kid-toy/shared-types';
import type {
  Brand,
  Category,
  CategoryTranslation,
  Product,
  ProductMedia,
  ProductTranslation,
  ProductVariant,
  SafetyCertification,
} from '../../../prisma/generated/prisma/client';
import type { ResolvedPrice } from '../pricing/price-resolution.service';
import {
  decimalToNumber,
  toCertificationDto,
  toMediaDto,
} from './catalog.mapper';

/**
 * The single place the API's PUBLIC catalog wire shape is defined —
 * mirrors catalog.mapper.ts's admin-side convention (never leak a raw
 * Prisma row to a client, T-01-40) but additionally never leaks a price
 * list, a tier enumeration, or an objectKey (T-01-50/51/53).
 */

type CategoryWithTranslation = Category & {
  translations: CategoryTranslation[];
};
type VariantWithCertifications = ProductVariant & {
  certifications: SafetyCertification[];
};

export type PublicProductListRow = Product & {
  translations: ProductTranslation[];
  brand: Brand | null;
  category: CategoryWithTranslation;
  variants: ProductVariant[];
  media: ProductMedia[];
};

export type PublicProductDetailRow = Product & {
  translations: ProductTranslation[];
  brand: Brand | null;
  category: CategoryWithTranslation;
  variants: VariantWithCertifications[];
  media: ProductMedia[];
};

const STOCK_RANK: Record<StockStatus, number> = {
  OUT_OF_STOCK: 0,
  LOW_STOCK: 1,
  IN_STOCK: 2,
};

/** Best status across a set of variants — IN_STOCK > LOW_STOCK > OUT_OF_STOCK. */
export function bestStockStatus(
  variantIds: string[],
  stockMap: ReadonlyMap<string, StockStatus>,
): StockStatus {
  let best: StockStatus = 'OUT_OF_STOCK';
  for (const id of variantIds) {
    const status = stockMap.get(id) ?? 'OUT_OF_STOCK';
    if (STOCK_RANK[status] > STOCK_RANK[best]) {
      best = status;
    }
  }
  return best;
}

function toCatalogPrice(
  resolved: ResolvedPrice | undefined,
): CatalogPrice | null {
  if (!resolved) {
    return null;
  }
  return {
    unitPriceVnd: resolved.unitPriceVnd.toString(),
    tierCode: resolved.tierCode,
    minQty: resolved.minQty,
  };
}

function sortBySku<T extends { sku: string }>(variants: T[]): T[] {
  return [...variants].sort((a, b) => a.sku.localeCompare(b.sku));
}

export function toCatalogListItem(
  product: PublicProductListRow,
  locale: 'vi' | 'en',
  priceMap: ReadonlyMap<string, ResolvedPrice>,
  stockMap: ReadonlyMap<string, StockStatus>,
  mediaUrlMap: ReadonlyMap<string, string>,
): CatalogListItem {
  const translation = product.translations[0];
  if (!translation) {
    // Unreachable in practice — the calling query always includes the
    // requested locale's translation row, and product creation requires
    // both locales (assertBothLocales). Never silently return a malformed
    // DTO if that invariant is ever violated.
    throw new Error(
      `Product ${product.id} is missing a "${locale}" translation`,
    );
  }
  const categoryTranslation = product.category.translations[0];
  const sortedVariants = sortBySku(product.variants);
  const firstVariant = sortedVariants[0];
  const primaryMedia = product.media[0];

  return {
    id: product.id,
    locale,
    name: translation.name,
    slug: translation.slug,
    categoryId: product.categoryId,
    categoryName: categoryTranslation?.name ?? '',
    brandId: product.brandId,
    brandName: product.brand?.name ?? null,
    origin: product.origin,
    ageRangeMin: product.ageRangeMin,
    ageRangeMax: product.ageRangeMax,
    gender: product.gender,
    primaryImageUrl: primaryMedia
      ? (mediaUrlMap.get(primaryMedia.id) ?? null)
      : null,
    price: firstVariant ? toCatalogPrice(priceMap.get(firstVariant.id)) : null,
    stockStatus: bestStockStatus(
      sortedVariants.map((v) => v.id),
      stockMap,
    ),
  };
}

export function toCatalogProductDetail(
  product: PublicProductDetailRow,
  locale: 'vi' | 'en',
  priceMap: ReadonlyMap<string, ResolvedPrice>,
  stockMap: ReadonlyMap<string, StockStatus>,
  mediaUrlMap: ReadonlyMap<string, string>,
): CatalogProductDetail {
  const prismaLocale = locale === 'vi' ? 'VI' : 'EN';
  const wanted = product.translations.find((t) => t.locale === prismaLocale);
  // Defense-in-depth only: by construction the caller (findBySlug) already
  // verified the requested locale's translation row exists before fetching
  // this full product row — this branch documents and covers the
  // theoretical "legacy row missing a locale" case (see 01-07-PLAN.md
  // Task 3 <behavior>) without ever silently substituting a description.
  const fallbackTranslation = product.translations.find(
    (t) => t.locale === 'VI',
  );
  const effective = wanted ?? fallbackTranslation;
  if (!effective) {
    throw new Error(`Product ${product.id} has no translations at all`);
  }
  const localeFallbackApplied = !wanted;

  const categoryTranslation = product.category.translations[0];
  const sortedVariants = sortBySku(product.variants);
  const firstVariant = sortedVariants[0];
  const sortedMedia = [...product.media].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  const variantSummaries: CatalogVariantSummary[] = sortedVariants.map((v) => ({
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    variantLabel: v.variantLabel,
    price: toCatalogPrice(priceMap.get(v.id)),
    stockStatus: stockMap.get(v.id) ?? 'OUT_OF_STOCK',
  }));

  return {
    id: product.id,
    locale,
    name: effective.name,
    slug: effective.slug,
    categoryId: product.categoryId,
    categoryName: categoryTranslation?.name ?? '',
    brandId: product.brandId,
    brandName: product.brand?.name ?? null,
    origin: product.origin,
    ageRangeMin: product.ageRangeMin,
    ageRangeMax: product.ageRangeMax,
    gender: product.gender,
    primaryImageUrl: sortedMedia[0]
      ? (mediaUrlMap.get(sortedMedia[0].id) ?? null)
      : null,
    price: firstVariant ? toCatalogPrice(priceMap.get(firstVariant.id)) : null,
    stockStatus: bestStockStatus(
      sortedVariants.map((v) => v.id),
      stockMap,
    ),
    description: effective.description,
    media: sortedMedia.map((m) => toMediaDto(m, mediaUrlMap.get(m.id) ?? '')),
    variants: variantSummaries,
    certifications: firstVariant
      ? firstVariant.certifications.map(toCertificationDto)
      : [],
    packaging: firstVariant
      ? {
          unitsPerInnerBox: firstVariant.unitsPerInnerBox,
          unitsPerMasterCarton: firstVariant.unitsPerMasterCarton,
          cartonLengthCm: decimalToNumber(firstVariant.cartonLengthCm),
          cartonWidthCm: decimalToNumber(firstVariant.cartonWidthCm),
          cartonHeightCm: decimalToNumber(firstVariant.cartonHeightCm),
          cartonWeightKg: decimalToNumber(firstVariant.cartonWeightKg),
        }
      : null,
    ...(localeFallbackApplied ? { localeFallbackApplied: true } : {}),
  };
}
