import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { CatalogProductDetail } from "@kid-toy/shared-types";
import { apiGet, ApiError } from "@/lib/api-client";
import { Link } from "@/i18n/navigation";
import { formatAgeRange } from "@/lib/format";
import PriceTag from "@/components/PriceTag";
import StockBadge from "@/components/StockBadge";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

const GENDER_LABEL_KEY: Record<CatalogProductDetail["gender"], "boy" | "girl" | "unisex"> = {
  BOY: "boy",
  GIRL: "girl",
  UNISEX: "unisex",
};

/**
 * Slugs are per-locale and never cross-resolve (01-07-SUMMARY.md): a
 * `vi` slug requested under `/en/...` 404s from the API, and we translate
 * that into Next's own `notFound()` rather than swallowing it. Any other
 * error propagates to the route's error boundary.
 */
async function loadProduct(slug: string, locale: Locale): Promise<CatalogProductDetail> {
  try {
    return await apiGet<CatalogProductDetail>(
      `/api/catalog/products/${encodeURIComponent(slug)}`,
      { searchParams: { locale }, auth: true },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  try {
    const product = await loadProduct(slug, locale);
    return {
      title: product.name,
      description: product.description ? product.description.slice(0, 160) : undefined,
    };
  } catch {
    return {};
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: Locale; slug: string }>;
}) {
  const { locale, slug } = await params;
  const product = await loadProduct(slug, locale);
  const t = await getTranslations({ locale, namespace: "Product" });
  const tCatalog = await getTranslations({ locale, namespace: "Catalog" });

  const sortedMedia = [...product.media].sort((a, b) => a.sortOrder - b.sortOrder);
  const packaging = product.packaging;
  const hasCartonDimensions =
    packaging?.cartonLengthCm != null &&
    packaging?.cartonWidthCm != null &&
    packaging?.cartonHeightCm != null;

  return (
    <main>
      <h1>{product.name}</h1>

      {product.localeFallbackApplied ? <p role="note">{t("localeFallbackNotice")}</p> : null}

      {sortedMedia.length > 0 ? (
        <div>
          {sortedMedia.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element -- presigned MinIO URL, not a next/image remote pattern
            <img
              key={m.id}
              src={m.url}
              alt={(locale === "vi" ? m.altTextVi : m.altTextEn) || product.name}
              width={320}
              height={320}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}

      {/* Staff-authored product copy, rendered as a plain React text node only — see T-01-61. */}
      {product.description ? <p>{product.description}</p> : null}

      <dl>
        <dt>{tCatalog("category")}</dt>
        <dd>{product.categoryName}</dd>
        <dt>{tCatalog("brand")}</dt>
        <dd>{product.brandName ?? "—"}</dd>
        <dt>{tCatalog("origin")}</dt>
        <dd>{product.origin}</dd>
        <dt>{tCatalog("ageRange")}</dt>
        <dd>{formatAgeRange(product.ageRangeMin, product.ageRangeMax, locale)}</dd>
        <dt>{tCatalog("gender")}</dt>
        <dd>{tCatalog(GENDER_LABEL_KEY[product.gender])}</dd>
      </dl>

      <h2>{t("variants")}</h2>
      <table>
        <thead>
          <tr>
            <th>{t("sku")}</th>
            <th>{t("variantLabel")}</th>
            <th>{t("barcode")}</th>
            <th>{t("price")}</th>
            <th>{t("stock")}</th>
          </tr>
        </thead>
        <tbody>
          {product.variants.map((v) => (
            <tr key={v.id}>
              <td>{v.sku}</td>
              <td>{v.variantLabel ?? "—"}</td>
              <td>{v.barcode ?? "—"}</td>
              <td>
                <PriceTag price={v.price} locale={locale} />
              </td>
              <td>
                <StockBadge status={v.stockStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {packaging ? (
        <>
          <h2>{t("packaging")}</h2>
          <dl>
            {packaging.unitsPerInnerBox != null ? (
              <>
                <dt>{t("unitsPerInnerBox")}</dt>
                <dd>{packaging.unitsPerInnerBox}</dd>
              </>
            ) : null}
            {packaging.unitsPerMasterCarton != null ? (
              <>
                <dt>{t("unitsPerMasterCarton")}</dt>
                <dd>{packaging.unitsPerMasterCarton}</dd>
              </>
            ) : null}
            {hasCartonDimensions ? (
              <>
                <dt>{t("cartonDimensions")}</dt>
                <dd>
                  {packaging.cartonLengthCm}×{packaging.cartonWidthCm}×{packaging.cartonHeightCm}
                </dd>
              </>
            ) : null}
            {packaging.cartonWeightKg != null ? (
              <>
                <dt>{t("cartonWeight")}</dt>
                <dd>{packaging.cartonWeightKg}</dd>
              </>
            ) : null}
          </dl>
        </>
      ) : null}

      {product.certifications.length > 0 ? (
        <>
          <h2>{t("certification")}</h2>
          <dl>
            {product.certifications.map((c) => (
              <div key={c.id}>
                <dt>{t("certNumber")}</dt>
                <dd>{c.certNumber}</dd>
                <dt>{t("issuingBody")}</dt>
                <dd>{c.issuingBody}</dd>
                <dt>{t("validUntil")}</dt>
                <dd>{new Date(c.validTo).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US")}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <p>
        <Link href="/catalog">{t("backToCatalog")}</Link>
      </p>
    </main>
  );
}
