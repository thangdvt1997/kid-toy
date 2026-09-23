import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { BrandDto, CategoryDto } from "@kid-toy/shared-types";
import { apiGet } from "@/lib/api-client";
import { requireStaff } from "@/lib/current-user";
import ProductForm from "@/components/admin/ProductForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("createProductTitle") };
}

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  await requireStaff(["SUPER_ADMIN", "CONTENT"]);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const [categories, brands] = await Promise.all([
    apiGet<CategoryDto[]>("/api/admin/categories", { auth: true }),
    apiGet<BrandDto[]>("/api/admin/brands", { auth: true }),
  ]);

  return (
    <main>
      <h1>{t("createProductTitle")}</h1>
      <ProductForm mode="create" categories={categories} brands={brands} locale={locale} />
    </main>
  );
}
