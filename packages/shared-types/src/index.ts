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

export {};
