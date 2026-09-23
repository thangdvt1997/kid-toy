import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AdminProductDto, BrandDto, CategoryDto } from "@kid-toy/shared-types";
import { apiGet, ApiError } from "@/lib/api-client";
import { requireStaff } from "@/lib/current-user";
import { softDeleteProductAction } from "@/lib/admin-actions";
import ProductForm from "@/components/admin/ProductForm";

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
 * extends this same page to mount VariantForm/MediaUploader/PriceStockForm
 * below the product form, fetching price tiers/entries and stock in the
 * same parallel `Promise.all` this file already establishes.
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
    </main>
  );
}
