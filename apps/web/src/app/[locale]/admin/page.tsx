import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/current-user";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("title") };
}

/**
 * Minimal landing page — links to the two sections plus the current staff
 * role. No dashboard widgets (ADMIN-01 is explicitly Phase 7 scope).
 */
export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const account = await requireStaff(["SUPER_ADMIN", "SALES", "WAREHOUSE", "CONTENT"]);
  const t = await getTranslations({ locale, namespace: "Admin" });

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("yourRole", { role: account.role ?? "" })}</p>
      <ul>
        <li>
          <Link href="/admin/products">{t("navProducts")}</Link>
        </li>
        <li>
          <Link href="/admin/business-accounts">{t("navBusinessAccounts")}</Link>
        </li>
      </ul>
    </main>
  );
}
