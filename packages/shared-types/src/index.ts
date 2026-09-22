export type Locale = "vi" | "en";

export type AccountType = "STAFF" | "RETAIL_CUSTOMER" | "BUSINESS_ACCOUNT";
export type StaffRole = "SUPER_ADMIN" | "SALES" | "WAREHOUSE" | "CONTENT";
export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export type BusinessType = "RETAIL_STORE" | "SCHOOL" | "DISTRIBUTOR";
export type BusinessApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface BusinessAccountSummary {
  id: string;
  accountId: string;
  email: string;
  companyName: string;
  taxId: string;
  businessType: BusinessType;
  approvalStatus: BusinessApprovalStatus;
  rejectionReason: string | null;
  priceTierId: string | null;
  priceTierCode: string | null;
  hasLicence: boolean;
}

export interface AuthenticatedAccount {
  id: string;
  email: string;
  type: AccountType;
  role?: StaffRole;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  priceTierId?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ---------------------------------------------------------------------
// Catalog (Phase 1 Plan 05 — CATALOG-01..05, 09)
// ---------------------------------------------------------------------

export interface TranslationInput {
  locale: "vi" | "en";
  name: string;
  slug: string;
  description?: string;
}

export interface BrandDto {
  id: string;
  name: string;
  originCountry: string | null;
}

export interface CategoryDto {
  id: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  translations: Record<"vi" | "en", { name: string; slug: string }>;
}

export interface CertificationDto {
  id: string;
  certNumber: string;
  issuingBody: string;
  validFrom: string;
  validTo: string;
  batchLabel: string | null;
}

export interface MediaDto {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  altTextVi: string | null;
  altTextEn: string | null;
  sortOrder: number;
}

export interface AdminVariantDto {
  id: string;
  sku: string;
  barcode: string | null;
  variantLabel: string | null;
  unitsPerInnerBox: number | null;
  unitsPerMasterCarton: number | null;
  cartonLengthCm: number | null;
  cartonWidthCm: number | null;
  cartonHeightCm: number | null;
  cartonWeightKg: number | null;
  isActive: boolean;
  certifications: CertificationDto[];
}

export interface AdminProductDto {
  id: string;
  categoryId: string;
  brandId: string | null;
  ageRangeMin: number;
  ageRangeMax: number;
  gender: "BOY" | "GIRL" | "UNISEX";
  origin: string;
  channelScope: "RETAIL_ONLY" | "WHOLESALE_ONLY" | "BOTH";
  isActive: boolean;
  translations: Record<"vi" | "en", { name: string; slug: string; description: string | null }>;
  variants: AdminVariantDto[];
  media: MediaDto[];
}

// ---------------------------------------------------------------------
// Pricing & stock (Phase 1 Plan 06 — CATALOG-06, CATALOG-08)
// ---------------------------------------------------------------------

export interface PriceTierDto {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
}

export interface PriceEntryDto {
  id: string;
  variantId: string;
  tierId: string;
  tierCode: string;
  minQty: number;
  unitPriceVnd: string; // VND as a decimal STRING — BigInt is not JSON-safe
}

export interface VariantStockDto {
  variantId: string;
  quantityOnHand: number;
  reorderThreshold: number;
  status: StockStatus;
}

// ---------------------------------------------------------------------
// Public catalog read path (Phase 1 Plan 07 — CATALOG-06, 07, 08, 09)
// ---------------------------------------------------------------------

export interface CatalogPrice {
  unitPriceVnd: string; // VND as a decimal STRING — BigInt is not JSON-safe
  tierCode: string;
  minQty: number;
}

export interface CatalogVariantSummary {
  id: string;
  sku: string;
  barcode: string | null;
  variantLabel: string | null;
  price: CatalogPrice | null;
  stockStatus: StockStatus;
}

export interface CatalogListItem {
  id: string;
  locale: "vi" | "en";
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  brandId: string | null;
  brandName: string | null;
  origin: string;
  ageRangeMin: number;
  ageRangeMax: number;
  gender: "BOY" | "GIRL" | "UNISEX";
  primaryImageUrl: string | null;
  price: CatalogPrice | null;
  stockStatus: StockStatus;
}

export interface CatalogProductDetail extends CatalogListItem {
  description: string | null;
  media: MediaDto[];
  variants: CatalogVariantSummary[];
  certifications: CertificationDto[];
  packaging: {
    unitsPerInnerBox: number | null;
    unitsPerMasterCarton: number | null;
    cartonLengthCm: number | null;
    cartonWidthCm: number | null;
    cartonHeightCm: number | null;
    cartonWeightKg: number | null;
  } | null;
  /** Set only when the requested locale's translation row was entirely absent and the `vi` row was used instead. */
  localeFallbackApplied?: boolean;
  /**
   * This same product's slug in the OTHER locale (vi<->en), or null if that
   * locale somehow has no translation row. Slugs are per-locale (CATALOG-09)
   * — a locale switcher on a product detail page must link here, never
   * reuse the current locale's slug under the other locale's path.
   */
  alternateLocaleSlug: string | null;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface AgeBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export {};
