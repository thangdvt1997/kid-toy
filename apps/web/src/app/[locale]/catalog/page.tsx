import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AgeBucket, CatalogListItem, FacetOption } from "@kid-toy/shared-types";
import { apiGet, ApiError } from "@/lib/api-client";
import { Link } from "@/i18n/navigation";
import CatalogFilters, { type CatalogFacets } from "@/components/CatalogFilters";
import ProductCard from "@/components/ProductCard";

// Never statically cached across viewers — same correctness reason as
// api-client's `cache: 'no-store'` default (T-01-59): prices and product
// visibility are viewer-dependent.
export const dynamic = "force-dynamic";

type Locale = "vi" | "en";
type SearchParams = Record<string, string | string[] | undefined>;

interface BrowseResult {
  items: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface FacetsResult {
  categories: FacetOption[];
  brands: FacetOption[];
  origins: FacetOption[];
  ageBuckets: AgeBucket[];
}

const PAGE_SIZE = 24;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildQuery(locale: Locale, sp: SearchParams, page: number) {
  return {
    locale,
    page,
    pageSize: PAGE_SIZE,
    categoryId: first(sp.categoryId),
    brandId: first(sp.brandId),
    origin: first(sp.origin),
    ageMin: first(sp.ageMin),
    ageMax: first(sp.ageMax),
    gender: first(sp.gender),
    search: first(sp.search),
    sort: first(sp.sort),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Catalog" });
  return { title: t("title") };
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "Catalog" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });

  const page = Math.max(1, Number(first(sp.page) ?? "1") || 1);
  const query = buildQuery(locale, sp, page);

  let facets: FacetsResult | undefined;
  let result: BrowseResult | undefined;
  let loadFailed = false;

  try {
    [facets, result] = await Promise.all([
      apiGet<FacetsResult>("/api/catalog/facets", {
        searchParams: { locale },
        auth: true,
      }),
      // `auth: true` on both requests is what makes an approved dealer see
      // wholesale prices and wholesale-only products on this same page.
      apiGet<BrowseResult>("/api/catalog/products", {
        searchParams: query,
        auth: true,
      }),
    ]);
  } catch (err) {
    // Never surface the raw ApiError message/stack to a visitor.
    loadFailed = true;
    if (!(err instanceof ApiError)) {
      throw err;
    }
  }

  if (loadFailed || !facets || !result) {
    return (
      <main>
        <h1>{t("title")}</h1>
        <p>{tCommon("error")}</p>
        <p>
          <Link href="/catalog">{tCommon("retry")}</Link>
        </p>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function buildPageHref(targetPage: number): string {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (key === "page" || key === "pageSize" || value === undefined || value === "") continue;
      next.set(key, String(value));
    }
    next.set("page", String(targetPage));
    return `/catalog?${next.toString()}`;
  }

  return (
    <main>
      <h1>{t("title")}</h1>
      <CatalogFilters facets={facets satisfies CatalogFacets} locale={locale} />
      <p>{t("resultsCount", { count: result.total })}</p>
      {result.items.length === 0 ? (
        <p>{t("noResults")}</p>
      ) : (
        <div>
          {result.items.map((item) => (
            <ProductCard key={item.id} item={item} locale={locale} />
          ))}
        </div>
      )}
      <nav>
        {page > 1 ? (
          <Link href={buildPageHref(page - 1)}>{t("previous")}</Link>
        ) : (
          <span aria-disabled="true">{t("previous")}</span>
        )}
        <span>{t("page", { page, totalPages })}</span>
        {page < totalPages ? (
          <Link href={buildPageHref(page + 1)}>{t("next")}</Link>
        ) : (
          <span aria-disabled="true">{t("next")}</span>
        )}
      </nav>
    </main>
  );
}
