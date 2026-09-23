"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type {
  AdminProductDto,
  AdminVariantDto,
  BusinessAccountSummary,
  CertificationDto,
  MediaDto,
  PriceEntryDto,
  TranslationInput,
  VariantStockDto,
} from "@kid-toy/shared-types";
import { apiGet, apiSend, ApiError } from "./api-client";

/**
 * Every admin Server Action returns this shape — never a raw thrown error,
 * never raw API text (T-01-73's convention, carried over from Plan 09's
 * auth-actions.ts). `data` is populated only where a caller actually needs
 * the response body; most callers only care about `ok`/`error`.
 */
export type ActionState<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Shared `useActionState` initial value for every admin form in this module. */
export const adminInitialState: ActionState = { ok: false, error: "" };

/**
 * Maps the API's stable string error CODE (thrown server-side as e.g.
 * `new BadRequestException('SLUG_TAKEN')`, which NestJS's default exception
 * filter serializes as `{ message: 'SLUG_TAKEN' }` — apps/web's ApiError
 * therefore carries the code in `.message`, not `.code`, exactly as
 * registerBusinessAction (Plan 09) already relies on) to a localized
 * message KEY under the `Admin` namespace.
 *
 * A 403 ALWAYS maps to `Admin.errForbidden` regardless of message and is
 * checked first — T-01-75 requires this never be swallowed, because a 403
 * here means the UI's `requireStaff` gate and the API's `RolesGuard`
 * disagree about who is allowed to call this action, and that must be
 * visible to the operator, not silently absorbed into a generic error.
 */
const ERROR_KEY_MAP: Record<string, string> = {
  BOTH_LOCALES_REQUIRED: "Admin.errBothLocales",
  SLUG_TAKEN: "Admin.errSlugTaken",
  AGE_RANGE_INVALID: "Admin.errAgeRange",
  CATEGORY_NOT_FOUND: "Admin.errCategoryNotFound",
  BRAND_NOT_FOUND: "Admin.errBrandNotFound",
  SKU_TAKEN: "Admin.errSkuTaken",
  BARCODE_TAKEN: "Admin.errBarcodeTaken",
  SKU_OR_BARCODE_TAKEN: "Admin.errSkuTaken",
  CARTON_MULTIPLE_INVALID: "Admin.errCartonInvalid",
  CERT_VALIDITY_INVALID: "Admin.errCertValidity",
  PRICE_TIER_REQUIRED: "Admin.errPriceTierRequired",
  TIER_NOT_FOUND: "Admin.errPriceTierRequired",
  DEFAULT_TIER_NOT_ASSIGNABLE: "Admin.errPriceTierRequired",
  REJECTION_REASON_REQUIRED: "Admin.errRejectionReasonRequired",
  LAST_RETAIL_PRICE: "Admin.errLastRetailPrice",
};

function mapError(err: unknown, fallback = "Admin.errUnknown"): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Admin.errForbidden";
    return ERROR_KEY_MAP[err.message] ?? fallback;
  }
  return "Admin.errUnknown";
}

/**
 * Revalidates every route a catalog mutation can affect: both locales'
 * public catalog listing (T-01-81 — a stale storefront could mask a bad
 * admin edit during Task 3's human verification) and the admin product
 * list/detail pages themselves.
 */
async function revalidateCatalogAndAdmin(productId?: string): Promise<void> {
  revalidatePath("/vi/catalog");
  revalidatePath("/en/catalog");
  revalidatePath("/vi/admin/products");
  revalidatePath("/en/admin/products");
  if (productId) {
    revalidatePath(`/vi/admin/products/${productId}`);
    revalidatePath(`/en/admin/products/${productId}`);
  }
}

// ---------------------------------------------------------------------
// Task 1 — products (CATALOG-01, CATALOG-09, AUTH-04)
// ---------------------------------------------------------------------

interface ProductFields {
  categoryId: string;
  brandId?: string;
  ageRangeMin: number;
  ageRangeMax: number;
  gender: string;
  origin: string;
  channelScope: string;
  translations: TranslationInput[];
}

/**
 * Builds the `translations` array from two possible fieldsets (`_vi`/`_en`
 * suffixed form fields). A locale with BOTH name and slug left blank is
 * OMITTED from the array entirely — this is deliberate: the API's
 * `assertBothLocales` only accepts exactly one `vi` and one `en` entry, so
 * omitting a locale (rather than sending it with empty strings) is what
 * actually reaches the `BOTH_LOCALES_REQUIRED` code path the plan's
 * behavior bullets require ("submitting with one locale blank surfaces
 * BOTH_LOCALES_REQUIRED").
 */
function buildTranslations(formData: FormData): TranslationInput[] {
  const translations: TranslationInput[] = [];
  for (const locale of ["vi", "en"] as const) {
    const name = String(formData.get(`name_${locale}`) ?? "").trim();
    const slug = String(formData.get(`slug_${locale}`) ?? "").trim();
    const description = String(formData.get(`description_${locale}`) ?? "").trim();
    if (!name && !slug) continue;
    translations.push({ locale, name, slug, description: description || undefined });
  }
  return translations;
}

function parseProductFields(formData: FormData): ProductFields | null {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const brandIdRaw = String(formData.get("brandId") ?? "").trim();
  const ageRangeMin = Number(formData.get("ageRangeMin"));
  const ageRangeMax = Number(formData.get("ageRangeMax"));
  const gender = String(formData.get("gender") ?? "").trim();
  const origin = String(formData.get("origin") ?? "").trim();
  const channelScope = String(formData.get("channelScope") ?? "").trim();
  if (
    !categoryId ||
    !gender ||
    !origin ||
    !channelScope ||
    Number.isNaN(ageRangeMin) ||
    Number.isNaN(ageRangeMax)
  ) {
    return null;
  }
  return {
    categoryId,
    brandId: brandIdRaw || undefined,
    ageRangeMin,
    ageRangeMax,
    gender,
    origin,
    channelScope,
    translations: buildTranslations(formData),
  };
}

/**
 * `useActionState`-shaped. On success, redirects to the new product's edit
 * page (never returns `{ ok: true }`) — mirrors loginAction's convention
 * (Plan 09) of only needing the error branch in the form component.
 */
export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = parseProductFields(formData);
  if (!fields) return { ok: false, error: "Admin.errUnknown" };

  let created: AdminProductDto;
  try {
    created = await apiSend<AdminProductDto>("POST", "/api/admin/products", fields, {
      auth: true,
    });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }

  await revalidateCatalogAndAdmin(created.id);
  const locale = await getLocale();
  redirect(`/${locale}/admin/products/${created.id}`);
}

/**
 * Bind `productId` first (`updateProductAction.bind(null, productId)`) so
 * the remaining `(prevState, formData)` signature matches `useActionState`
 * — the documented Next.js pattern for passing an extra argument to a
 * Server Action alongside `useActionState` (see forms.md "Passing
 * additional arguments").
 */
export async function updateProductAction(
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = parseProductFields(formData);
  if (!fields) return { ok: false, error: "Admin.errUnknown" };

  try {
    await apiSend<AdminProductDto>("PATCH", `/api/admin/products/${productId}`, fields, {
      auth: true,
    });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/** Bound via `.bind(null, product.id)` onto a plain `<form>` from a Server Component. */
export async function softDeleteProductAction(productId: string): Promise<ActionState> {
  try {
    await apiSend<void>("DELETE", `/api/admin/products/${productId}`, undefined, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Taxonomy (brands/categories) — contracts this plan's <interfaces> block
// specifies, kept complete even though no dedicated create-brand/
// create-category screen is in scope for this plan's minimal admin UI
// (categories/brands are seed data per Plan 05; ProductForm only needs to
// READ them for its <select> options). Not wired to any component here —
// documented in the plan Summary, not a stub (these are fully functional,
// simply unused by this plan's own screens).
// ---------------------------------------------------------------------

export async function createCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parentId = String(formData.get("parentId") ?? "").trim() || undefined;
  const translations = buildTranslations(formData);
  try {
    await apiSend("POST", "/api/admin/categories", { parentId, translations }, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  revalidatePath("/vi/admin/products");
  revalidatePath("/en/admin/products");
  return { ok: true };
}

export async function createBrandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const originCountry = String(formData.get("originCountry") ?? "").trim() || undefined;
  if (!name) return { ok: false, error: "Admin.errUnknown" };
  try {
    await apiSend("POST", "/api/admin/brands", { name, originCountry }, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  revalidatePath("/vi/admin/products");
  revalidatePath("/en/admin/products");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Task 2 — variants, certifications, media, prices/stock, dealer approval
// (CATALOG-02..06, CATALOG-08, AUTH-03/04)
// ---------------------------------------------------------------------

interface VariantFields {
  sku: string;
  barcode?: string;
  variantLabel?: string;
  unitsPerInnerBox?: number;
  unitsPerMasterCarton?: number;
  cartonLengthCm?: number;
  cartonWidthCm?: number;
  cartonHeightCm?: number;
  cartonWeightKg?: number;
}

function numberOrUndefined(formData: FormData, key: string): number | undefined {
  const raw = formData.get(key);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

function parseVariantFields(formData: FormData): VariantFields | null {
  // SKU is always coerced to uppercase server-side regardless of what the
  // browser sent — the visual `text-transform: uppercase` on the input in
  // VariantForm.tsx is cosmetic only, this is the real normalization.
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  if (!sku) return null;
  return {
    sku,
    barcode: String(formData.get("barcode") ?? "").trim() || undefined,
    variantLabel: String(formData.get("variantLabel") ?? "").trim() || undefined,
    unitsPerInnerBox: numberOrUndefined(formData, "unitsPerInnerBox"),
    unitsPerMasterCarton: numberOrUndefined(formData, "unitsPerMasterCarton"),
    cartonLengthCm: numberOrUndefined(formData, "cartonLengthCm"),
    cartonWidthCm: numberOrUndefined(formData, "cartonWidthCm"),
    cartonHeightCm: numberOrUndefined(formData, "cartonHeightCm"),
    cartonWeightKg: numberOrUndefined(formData, "cartonWeightKg"),
  };
}

export async function createVariantAction(
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = parseVariantFields(formData);
  if (!fields) return { ok: false, error: "Admin.errUnknown" };
  try {
    await apiSend<AdminVariantDto>("POST", `/api/admin/products/${productId}/variants`, fields, {
      auth: true,
    });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

export async function updateVariantAction(
  productId: string,
  variantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = parseVariantFields(formData);
  if (!fields) return { ok: false, error: "Admin.errUnknown" };
  try {
    await apiSend<AdminVariantDto>("PATCH", `/api/admin/variants/${variantId}`, fields, {
      auth: true,
    });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

function parseCertificationFields(
  formData: FormData,
): { certNumber: string; issuingBody: string; validFrom: string; validTo: string; batchLabel?: string } | null {
  const certNumber = String(formData.get("certNumber") ?? "").trim();
  const issuingBody = String(formData.get("issuingBody") ?? "").trim();
  const validFrom = String(formData.get("validFrom") ?? "").trim();
  const validTo = String(formData.get("validTo") ?? "").trim();
  if (!certNumber || !issuingBody || !validFrom || !validTo) return null;
  return {
    certNumber,
    issuingBody,
    validFrom,
    validTo,
    batchLabel: String(formData.get("batchLabel") ?? "").trim() || undefined,
  };
}

export async function createCertificationAction(
  productId: string,
  variantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = parseCertificationFields(formData);
  if (!fields) return { ok: false, error: "Admin.errUnknown" };
  try {
    await apiSend<CertificationDto>(
      "POST",
      `/api/admin/variants/${variantId}/certifications`,
      fields,
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/** Not `useActionState`-bound — invoked directly from a plain `<form action>` (see VariantForm.tsx's CertificationRow). */
export async function deleteCertificationAction(productId: string, certId: string): Promise<ActionState> {
  try {
    await apiSend<void>("DELETE", `/api/admin/certifications/${certId}`, undefined, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/**
 * `formData` is passed through to `apiSend`'s `formData` option (multipart
 * passthrough) — never re-encoded as JSON, since it carries the actual
 * uploaded `File`.
 */
export async function uploadMediaAction(
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Admin.errMediaTypeMismatch" };
  }
  const type = String(formData.get("type") ?? "");
  if (type !== "IMAGE" && type !== "VIDEO") {
    return { ok: false, error: "Admin.errUnknown" };
  }

  const payload = new FormData();
  payload.set("type", type);
  const altTextVi = String(formData.get("altTextVi") ?? "").trim();
  const altTextEn = String(formData.get("altTextEn") ?? "").trim();
  if (altTextVi) payload.set("altTextVi", altTextVi);
  if (altTextEn) payload.set("altTextEn", altTextEn);
  payload.set("file", file);

  try {
    await apiSend<MediaDto>("POST", `/api/admin/products/${productId}/media`, undefined, {
      auth: true,
      formData: payload,
    });
  } catch (err) {
    // NestJS's ParseFilePipe validation failures (wrong mimetype/oversized)
    // don't carry a stable string code the way this codebase's own
    // BadRequestException('CODE') throws do — fall back to
    // errMediaTypeMismatch specifically for this action rather than the
    // generic errUnknown.
    return { ok: false, error: mapError(err, "Admin.errMediaTypeMismatch") };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/** Always submits the FULL recomputed id list — the API rejects a partial/duplicate/foreign set. */
export async function reorderMediaAction(productId: string, orderedIds: string[]): Promise<ActionState> {
  try {
    await apiSend<MediaDto[]>(
      "PATCH",
      `/api/admin/products/${productId}/media/order`,
      { orderedIds },
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

export async function deleteMediaAction(productId: string, mediaId: string): Promise<ActionState> {
  try {
    await apiSend<void>("DELETE", `/api/admin/media/${mediaId}`, undefined, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/**
 * `unitPriceVnd` is read directly from the form field and forwarded
 * VERBATIM as a string — never `Number(...)`'d (T-01-79). Coercing a
 * 15-digit VND amount through a JS `number` would silently lose precision.
 */
export async function setPriceAction(
  productId: string,
  variantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tierId = String(formData.get("tierId") ?? "").trim();
  const minQty = Number(formData.get("minQty"));
  const unitPriceVnd = String(formData.get("unitPriceVnd") ?? "").trim();
  if (!tierId || !unitPriceVnd || Number.isNaN(minQty)) {
    return { ok: false, error: "Admin.errUnknown" };
  }
  try {
    await apiSend<PriceEntryDto>(
      "PUT",
      `/api/admin/variants/${variantId}/prices`,
      { tierId, minQty, unitPriceVnd },
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

/**
 * Not part of the plan's literal `<interfaces>` action list, but required
 * for the plan's OWN behavior bullet ("deleting the last retail entry
 * surfaces LAST_RETAIL_PRICE") to be reachable from the UI at all — Rule 2
 * (missing critical functionality): without a delete action, that
 * acceptance criterion has no code path to exercise.
 */
export async function deletePriceEntryAction(productId: string, entryId: string): Promise<ActionState> {
  try {
    await apiSend<void>("DELETE", `/api/admin/price-entries/${entryId}`, undefined, { auth: true });
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true };
}

export async function setStockAction(
  productId: string,
  variantId: string,
  _prev: ActionState<VariantStockDto>,
  formData: FormData,
): Promise<ActionState<VariantStockDto>> {
  const quantityOnHand = Number(formData.get("quantityOnHand"));
  const reorderThreshold = Number(formData.get("reorderThreshold"));
  if (Number.isNaN(quantityOnHand) || Number.isNaN(reorderThreshold)) {
    return { ok: false, error: "Admin.errUnknown" };
  }
  let result: VariantStockDto;
  try {
    result = await apiSend<VariantStockDto>(
      "PUT",
      `/api/admin/variants/${variantId}/stock`,
      { quantityOnHand, reorderThreshold },
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  await revalidateCatalogAndAdmin(productId);
  return { ok: true, data: result };
}

export async function approveBusinessAccountAction(
  accountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const priceTierId = String(formData.get("priceTierId") ?? "").trim();
  if (!priceTierId) return { ok: false, error: "Admin.errPriceTierRequired" };
  try {
    await apiSend<BusinessAccountSummary>(
      "PATCH",
      `/api/admin/business-accounts/${accountId}/approval`,
      { approvalStatus: "APPROVED", priceTierId },
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  revalidatePath("/vi/admin/business-accounts");
  revalidatePath("/en/admin/business-accounts");
  return { ok: true };
}

export async function rejectBusinessAccountAction(
  accountId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
  if (!rejectionReason) return { ok: false, error: "Admin.errRejectionReasonRequired" };
  try {
    await apiSend<BusinessAccountSummary>(
      "PATCH",
      `/api/admin/business-accounts/${accountId}/approval`,
      { approvalStatus: "REJECTED", rejectionReason },
      { auth: true },
    );
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
  revalidatePath("/vi/admin/business-accounts");
  revalidatePath("/en/admin/business-accounts");
  return { ok: true };
}

/**
 * Mints a short-lived presigned URL on demand — the raw object key never
 * reaches this page's HTML (T-01-77). Not `useActionState`-bound; called
 * directly from ApprovalForm's "View licence" button handler.
 */
export async function getLicenceUrlAction(accountId: string): Promise<ActionState<{ url: string }>> {
  try {
    const result = await apiGet<{ url: string; expiresInSeconds: number }>(
      `/api/business-accounts/${accountId}/licence`,
      { auth: true },
    );
    return { ok: true, data: { url: result.url } };
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
}
