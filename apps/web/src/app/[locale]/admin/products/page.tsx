import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AdminProductDto, BrandDto, CategoryDto } from "@kid-toy/shared-types";
import { apiGet, ApiError } from "@/lib/api-client";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/current-user";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";
type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("productsTitle") };
}

/**
 * `requireStaff(['SUPER_ADMIN', 'CONTENT'])` here narrows the layout's
 * broader staff-only gate — a SALES or WAREHOUSE session reaching this
 * exact path 404s (AUTH-04's UI half); the `apiGet(..., { auth: true })`
 * call below is the API half, wrapped in try/catch as defense in depth
 * (the plan's own acceptance criteria treat both as independently
 * required, never one alone).
 */
export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  await requireStaff(["SUPER_ADMIN", "CONTENT"]);
  const t = await getTranslations({ locale, namespace: "Admin" });
  const tCommon = await getTranslations({ locale, namespace: "Common" });

  const page = Math.max(1, Number(first(sp.page) ?? "1") || 1);
  const search = first(sp.search) ?? "";

  let result: { items: AdminProductDto[]; total: number } | undefined;
  let categories: CategoryDto[] = [];
  let brands: BrandDto[] = [];
  let forbidden = false;
  let loadFailed = false;
  try {
    [result, categories, brands] = await Promise.all([
      apiGet<{ items: AdminProductDto[]; total: number }>("/api/admin/products", {
        searchParams: { page, pageSize: PAGE_SIZE, search },
        auth: true,
      }),
      apiGet<CategoryDto[]>("/api/admin/categories", { auth: true }),
      apiGet<BrandDto[]>("/api/admin/brands", { auth: true }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      forbidden = true;
    } else {
      loadFailed = true;
    }
  }

  if (forbidden) {
    return (
      <main>
        <h1>{t("productsTitle")}</h1>
        <p role="alert">{t("errForbidden")}</p>
      </main>
    );
  }
  if (loadFailed || !result) {
    return (
      <main>
        <h1>{t("productsTitle")}</h1>
        <p>{tCommon("error")}</p>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const categoryNames = new Map(categories.map((c) => [c.id, c.translations[locale]?.name ?? c.translations.vi.name]));
  const brandNames = new Map(brands.map((b) => [b.id, b.name]));

  function buildHref(targetPage: number): string {
    const next = new URLSearchParams();
    if (search) next.set("search", search);
    next.set("page", String(targetPage));
    return `/admin/products?${next.toString()}`;
  }

  return (
    <main>
      <h1>{t("productsTitle")}</h1>
      <p>
        <Link href="/admin/products/new">{t("newProduct")}</Link>
      </p>
      <form>
        <label>
          {t("search")}
          <input type="search" name="search" defaultValue={search} placeholder={t("searchPlaceholder")} />
        </label>
        <button type="submit">{t("search")}</button>
      </form>
      {result.items.length === 0 ? (
        <p>{t("noResults")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("columnName")}</th>
              <th>{t("columnCategory")}</th>
              <th>{t("columnBrand")}</th>
              <th>{t("columnVariants")}</th>
              <th>{t("columnActive")}</th>
              <th>{t("columnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((product) => (
              <tr key={product.id}>
                <td>{product.translations[locale]?.name ?? product.translations.vi.name}</td>
                <td>{categoryNames.get(product.categoryId) ?? product.categoryId}</td>
                <td>{product.brandId ? (brandNames.get(product.brandId) ?? product.brandId) : "—"}</td>
                <td>{product.variants.length}</td>
                <td>{product.isActive ? t("active") : t("inactive")}</td>
                <td>
                  <Link href={`/admin/products/${product.id}`}>{t("edit")}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav>
        {page > 1 ? (
          <Link href={buildHref(page - 1)}>{t("previous")}</Link>
        ) : (
          <span aria-disabled="true">{t("previous")}</span>
        )}
        <span>{t("page", { page, totalPages })}</span>
        {page < totalPages ? (
          <Link href={buildHref(page + 1)}>{t("next")}</Link>
        ) : (
          <span aria-disabled="true">{t("next")}</span>
        )}
      </nav>
    </main>
  );
}
