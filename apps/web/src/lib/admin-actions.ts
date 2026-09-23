"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AdminProductDto, TranslationInput } from "@kid-toy/shared-types";
import { apiSend, ApiError } from "./api-client";

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
