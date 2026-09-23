"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import type { AdminProductDto, BrandDto, CategoryDto } from "@kid-toy/shared-types";
import FormError from "@/components/FormError";
import {
  adminInitialState,
  createProductAction,
  updateProductAction,
} from "@/lib/admin-actions";

const GENDER_VALUES = ["BOY", "GIRL", "UNISEX"] as const;
const GENDER_LABEL_KEY: Record<(typeof GENDER_VALUES)[number], "genderBoy" | "genderGirl" | "genderUnisex"> = {
  BOY: "genderBoy",
  GIRL: "genderGirl",
  UNISEX: "genderUnisex",
};

const CHANNEL_SCOPE_VALUES = ["BOTH", "RETAIL_ONLY", "WHOLESALE_ONLY"] as const;
const CHANNEL_SCOPE_LABEL_KEY: Record<
  (typeof CHANNEL_SCOPE_VALUES)[number],
  "channelScopeBoth" | "channelScopeRetailOnly" | "channelScopeWholesaleOnly"
> = {
  BOTH: "channelScopeBoth",
  RETAIL_ONLY: "channelScopeRetailOnly",
  WHOLESALE_ONLY: "channelScopeWholesaleOnly",
};

/**
 * Strips Vietnamese diacritics (including đ/Đ, which do NOT decompose via
 * Unicode NFD like the other diacritic marks do) and hyphenates — used only
 * to SUGGEST a slug; the input stays editable and is never force-overwritten
 * once the user has typed into it directly (see `touched` state below).
 */
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function LocaleFieldset({
  locale,
  label,
  defaultName,
  defaultSlug,
  defaultDescription,
}: {
  locale: "vi" | "en";
  label: string;
  defaultName: string;
  defaultSlug: string;
  defaultDescription: string;
}) {
  const t = useTranslations("Admin");
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(defaultSlug);
  // Once the product already has a slug (edit mode) OR the user has typed
  // into the slug field directly, the auto-suggestion stops overwriting it.
  const [slugTouched, setSlugTouched] = useState(defaultSlug.length > 0);

  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        {t("name")}
        <input
          name={`name_${locale}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </label>
      <label>
        {t("slug")}
        <input
          name={`slug_${locale}`}
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
          }}
        />
      </label>
      <label>
        {t("description")}
        <textarea name={`description_${locale}`} defaultValue={defaultDescription} />
      </label>
    </fieldset>
  );
}

export default function ProductForm({
  mode,
  product,
  categories,
  brands,
  locale,
}: {
  mode: "create" | "edit";
  product?: AdminProductDto;
  categories: CategoryDto[];
  brands: BrandDto[];
  locale: "vi" | "en";
}) {
  const t = useTranslations("Admin");
  const action = mode === "edit" && product ? updateProductAction.bind(null, product.id) : createProductAction;
  const [state, formAction, pending] = useActionState(action, adminInitialState);

  return (
    <form action={formAction}>
      <LocaleFieldset
        locale="vi"
        label="Tiếng Việt"
        defaultName={product?.translations.vi.name ?? ""}
        defaultSlug={product?.translations.vi.slug ?? ""}
        defaultDescription={product?.translations.vi.description ?? ""}
      />
      <LocaleFieldset
        locale="en"
        label="English"
        defaultName={product?.translations.en.name ?? ""}
        defaultSlug={product?.translations.en.slug ?? ""}
        defaultDescription={product?.translations.en.description ?? ""}
      />

      <label>
        {t("category")}
        <select name="categoryId" defaultValue={product?.categoryId ?? ""} required>
          <option value="" disabled>
            {t("selectCategory")}
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.translations[locale]?.name ?? c.translations.vi.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("brand")}
        <select name="brandId" defaultValue={product?.brandId ?? ""}>
          <option value="">{t("noBrand")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("ageRangeMin")}
        <input type="number" name="ageRangeMin" min={0} max={18} defaultValue={product?.ageRangeMin ?? 0} required />
      </label>
      <label>
        {t("ageRangeMax")}
        <input type="number" name="ageRangeMax" min={0} max={18} defaultValue={product?.ageRangeMax ?? 18} required />
      </label>

      <label>
        {t("origin")}
        <input name="origin" defaultValue={product?.origin ?? ""} required />
      </label>

      <label>
        {t("gender")}
        <select name="gender" defaultValue={product?.gender ?? "UNISEX"} required>
          {GENDER_VALUES.map((g) => (
            <option key={g} value={g}>
              {t(GENDER_LABEL_KEY[g])}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("channelScope")}
        <select name="channelScope" defaultValue={product?.channelScope ?? "BOTH"} required>
          {CHANNEL_SCOPE_VALUES.map((c) => (
            <option key={c} value={c}>
              {t(CHANNEL_SCOPE_LABEL_KEY[c])}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" disabled={pending}>
        {mode === "create" ? t("createProduct") : t("saveChanges")}
      </button>
      <FormError messageKey={state.ok ? undefined : state.error || undefined} />
    </form>
  );
}
