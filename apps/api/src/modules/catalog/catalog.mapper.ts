import type {
  AdminProductDto,
  AdminVariantDto,
  BrandDto,
  CategoryDto,
  CertificationDto,
  MediaDto,
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

/**
 * The single place the API's admin catalog wire shape is defined.
 * Controllers must return ONLY what these functions produce — never a raw
 * Prisma row — so a schema-shape change (new column, renamed relation)
 * cannot silently leak into a response body. See T-01-40 in the threat
 * model (internal Prisma error/row shapes must never reach a client).
 */

type CategoryWithTranslations = Category & { translations: CategoryTranslation[] };
type VariantWithCertifications = ProductVariant & { certifications: SafetyCertification[] };
type ProductWithRelations = Product & {
  translations: ProductTranslation[];
  variants: VariantWithCertifications[];
  media: ProductMedia[];
};

/** Decimal fields arrive as Prisma's decimal.js-compatible instances; Number() coerces via their own toString/valueOf. */
export function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function toLocaleRecord<T extends { locale: 'VI' | 'EN' }>(
  rows: T[],
): Partial<Record<'vi' | 'en', T>> {
  const result: Partial<Record<'vi' | 'en', T>> = {};
  for (const row of rows) {
    result[row.locale === 'VI' ? 'vi' : 'en'] = row;
  }
  return result;
}

export function toCategoryDto(category: CategoryWithTranslations): CategoryDto {
  const byLocale = toLocaleRecord(category.translations);
  const vi = byLocale.vi;
  const en = byLocale.en;
  if (!vi || !en) {
    // Should be unreachable in practice — createCategory/updateCategory
    // guarantee both rows exist via assertBothLocales — but never silently
    // return a malformed DTO if the invariant is ever violated.
    throw new Error(`Category ${category.id} is missing a vi or en translation row`);
  }
  return {
    id: category.id,
    parentId: category.parentId,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    translations: {
      vi: { name: vi.name, slug: vi.slug },
      en: { name: en.name, slug: en.slug },
    },
  };
}

export function toBrandDto(brand: Brand): BrandDto {
  return {
    id: brand.id,
    name: brand.name,
    originCountry: brand.originCountry,
  };
}

export function toCertificationDto(cert: SafetyCertification): CertificationDto {
  return {
    id: cert.id,
    certNumber: cert.certNumber,
    issuingBody: cert.issuingBody,
    validFrom: cert.validFrom.toISOString(),
    validTo: cert.validTo.toISOString(),
    batchLabel: cert.batchLabel,
  };
}

export function toMediaDto(media: ProductMedia, url: string): MediaDto {
  return {
    id: media.id,
    type: media.type,
    url,
    altTextVi: media.altTextVi,
    altTextEn: media.altTextEn,
    sortOrder: media.sortOrder,
  };
}

export function toAdminVariantDto(variant: VariantWithCertifications): AdminVariantDto {
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    variantLabel: variant.variantLabel,
    unitsPerInnerBox: variant.unitsPerInnerBox,
    unitsPerMasterCarton: variant.unitsPerMasterCarton,
    cartonLengthCm: decimalToNumber(variant.cartonLengthCm),
    cartonWidthCm: decimalToNumber(variant.cartonWidthCm),
    cartonHeightCm: decimalToNumber(variant.cartonHeightCm),
    cartonWeightKg: decimalToNumber(variant.cartonWeightKg),
    isActive: variant.isActive,
    certifications: variant.certifications.map(toCertificationDto),
  };
}

/**
 * `mediaUrls` is a pre-resolved id -> presigned-URL map so this mapper stays
 * pure (no StorageService call inside a mapper) — MediaService resolves all
 * URLs for a product's media in one batch before calling this function.
 */
export function toAdminProductDto(
  product: ProductWithRelations,
  mediaUrls: ReadonlyMap<string, string>,
): AdminProductDto {
  const byLocale = toLocaleRecord(product.translations);
  const vi = byLocale.vi;
  const en = byLocale.en;
  if (!vi || !en) {
    throw new Error(`Product ${product.id} is missing a vi or en translation row`);
  }
  return {
    id: product.id,
    categoryId: product.categoryId,
    brandId: product.brandId,
    ageRangeMin: product.ageRangeMin,
    ageRangeMax: product.ageRangeMax,
    gender: product.gender,
    origin: product.origin,
    channelScope: product.channelScope,
    isActive: product.isActive,
    translations: {
      vi: { name: vi.name, slug: vi.slug, description: vi.description },
      en: { name: en.name, slug: en.slug, description: en.description },
    },
    variants: product.variants.map(toAdminVariantDto),
    media: product.media
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => toMediaDto(m, mediaUrls.get(m.id) ?? '')),
  };
}
