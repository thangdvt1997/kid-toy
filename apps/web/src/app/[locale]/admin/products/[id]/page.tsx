import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type {
  AdminProductDto,
  BrandDto,
  CategoryDto,
  PriceEntryDto,
  PriceTierDto,
} from "@kid-toy/shared-types";
import { apiGet, ApiError } from "@/lib/api-client";
import { requireStaff } from "@/lib/current-user";
import { softDeleteProductAction } from "@/lib/admin-actions";
import ProductForm from "@/components/admin/ProductForm";
import VariantForm from "@/components/admin/VariantForm";
import MediaUploader from "@/components/admin/MediaUploader";
import PriceStockForm from "@/components/admin/PriceStockForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("editProductTitle") };
}

/**
 * Task 1 wires the bilingual product form and deactivate action. Task 2
 * extends this same page with the variants/certifications section, the
 * media uploader, and a per-variant price/stock section.
 *
 * Price tiers (and therefore per-variant price entries) are fetched here,
 * server-side, and a 403 is tolerated — a CONTENT-role session simply
 * renders `priceForbidden`'s notice for that section (SUPER_ADMIN|SALES is
 * required by the API for both routes) rather than a broken form. There is
 * no equivalent GET for current stock levels at all (VariantStockService
 * is a deliberately thin Phase 1 stub — see 01-06-SUMMARY.md) — the stock
 * section is therefore always rendered and only reveals a role boundary
 * when WRITTEN by a non-WAREHOUSE/SUPER_ADMIN session.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ locale: Locale; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(["SUPER_ADMIN", "CONTENT"]);
  const t = await getTranslations({ locale, namespace: "Admin" });

  let product: AdminProductDto;
  let categories: CategoryDto[];
  let brands: BrandDto[];
  try {
    [product, categories, brands] = await Promise.all([
      apiGet<AdminProductDto>(`/api/admin/products/${id}`, { auth: true }),
      apiGet<CategoryDto[]>("/api/admin/categories", { auth: true }),
      apiGet<BrandDto[]>("/api/admin/brands", { auth: true }),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  let tiers: PriceTierDto[] = [];
  let priceForbidden = false;
  try {
    tiers = await apiGet<PriceTierDto[]>("/api/admin/price-tiers", { auth: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      priceForbidden = true;
    } else {
      throw err;
    }
  }

  const entriesByVariant = new Map<string, PriceEntryDto[]>();
  if (!priceForbidden) {
    const results = await Promise.all(
      product.variants.map((variant) =>
        apiGet<PriceEntryDto[]>(`/api/admin/variants/${variant.id}/prices`, { auth: true }),
      ),
    );
    product.variants.forEach((variant, index) => {
      entriesByVariant.set(variant.id, results[index]);
    });
  }

  async function deactivate() {
    "use server";
    await softDeleteProductAction(id);
  }

  return (
    <main>
      <h1>{t("editProductTitle")}</h1>
      <ProductForm mode="edit" product={product} categories={categories} brands={brands} locale={locale} />
      <form action={deactivate}>
        <button type="submit">{t("deactivate")}</button>
      </form>

      <section>
        <h2>{t("variantsTitle")}</h2>
        {product.variants.map((variant) => (
          <div key={variant.id}>
            <VariantForm productId={id} variant={variant} />
            <PriceStockForm
              productId={id}
              variantId={variant.id}
              tiers={tiers}
              entries={entriesByVariant.get(variant.id) ?? []}
              priceForbidden={priceForbidden}
            />
          </div>
        ))}
        <h3>{t("addVariant")}</h3>
        <VariantForm productId={id} />
      </section>

      <MediaUploader productId={id} media={product.media} />
    </main>
  );
}
