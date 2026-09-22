"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { formatAgeRange } from "@/lib/format";
import type { AgeBucket, FacetOption } from "@kid-toy/shared-types";

export interface CatalogFacets {
  categories: FacetOption[];
  brands: FacetOption[];
  origins: FacetOption[];
  ageBuckets: AgeBucket[];
}

const GENDER_VALUES = ["BOY", "GIRL", "UNISEX"] as const;
const GENDER_LABEL_KEY: Record<(typeof GENDER_VALUES)[number], "boy" | "girl" | "unisex"> = {
  BOY: "boy",
  GIRL: "girl",
  UNISEX: "unisex",
};

export default function CatalogFilters({
  facets,
  locale,
}: {
  facets: CatalogFacets;
  locale: "vi" | "en";
}) {
  const t = useTranslations("Catalog");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentAgeMin = searchParams.get("ageMin") ?? "";
  const currentAgeMax = searchParams.get("ageMax") ?? "";
  const currentAgeKey = currentAgeMin && currentAgeMax ? `${currentAgeMin}-${currentAgeMax}` : "";

  // Every filter change resets to page 1 — a filtered result set on a stale
  // page number would silently render an empty/wrong page.
  function navigate(next: URLSearchParams) {
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    navigate(next);
  }

  function handleAgeChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete("ageMin");
      next.delete("ageMax");
    } else {
      const [min, max] = value.split("-");
      if (min && max) {
        next.set("ageMin", min);
        next.set("ageMax", max);
      }
    }
    navigate(next);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setParam("search", String(formData.get("search") ?? "").trim());
  }

  return (
    <form onSubmit={handleSearchSubmit} aria-label={t("filters")}>
      <label>
        {t("category")}
        <select
          value={searchParams.get("categoryId") ?? ""}
          onChange={(e) => setParam("categoryId", e.target.value)}
        >
          <option value="">{t("allCategories")}</option>
          {facets.categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label} ({c.count})
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("brand")}
        <select
          value={searchParams.get("brandId") ?? ""}
          onChange={(e) => setParam("brandId", e.target.value)}
        >
          <option value="">{t("allBrands")}</option>
          {facets.brands.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label} ({b.count})
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("origin")}
        <select
          value={searchParams.get("origin") ?? ""}
          onChange={(e) => setParam("origin", e.target.value)}
        >
          <option value="">{t("allOrigins")}</option>
          {facets.origins.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("gender")}
        <select
          value={searchParams.get("gender") ?? ""}
          onChange={(e) => setParam("gender", e.target.value)}
        >
          <option value="">{t("allGenders")}</option>
          {GENDER_VALUES.map((g) => (
            <option key={g} value={g}>
              {t(GENDER_LABEL_KEY[g])}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("ageRange")}
        <select value={currentAgeKey} onChange={(e) => handleAgeChange(e.target.value)}>
          <option value="">{t("anyAge")}</option>
          {facets.ageBuckets.map((bucket) => (
            <option key={`${bucket.min}-${bucket.max}`} value={`${bucket.min}-${bucket.max}`}>
              {formatAgeRange(bucket.min, bucket.max, locale)} ({bucket.count})
            </option>
          ))}
        </select>
      </label>

      <label>
        {t("search")}
        <input type="search" name="search" defaultValue={searchParams.get("search") ?? ""} />
      </label>

      <button type="submit">{t("apply")}</button>
      <Link href={pathname}>{t("clear")}</Link>
    </form>
  );
}
