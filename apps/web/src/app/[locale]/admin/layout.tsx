import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/current-user";
import { logoutAction } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

/**
 * Server-gated wrapper for the whole `/[locale]/admin/**` route group.
 *
 * This gate is a UX convenience ONLY — the API's `RolesGuard` is the real
 * enforcement point (AUTH-04, T-01-75). It exists so an anonymous or
 * wrong-role visitor never even sees an admin page shell before their
 * first API call would 401/403 — every Server Action in `admin-actions.ts`
 * still independently handles a 403 from the API and surfaces it rather
 * than assuming this gate was sufficient.
 *
 * Deliberately staff-only at this level (any of the four staff roles) —
 * individual pages below narrow further (e.g. only SUPER_ADMIN/CONTENT can
 * reach the product forms), exactly as `<interfaces>` describes.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const account = await requireStaff(["SUPER_ADMIN", "SALES", "WAREHOUSE", "CONTENT"]);
  const t = await getTranslations({ locale, namespace: "Admin" });
  const tAuth = await getTranslations({ locale, namespace: "Auth" });

  return (
    <div>
      <nav aria-label={t("title")}>
        <Link href="/admin">{t("title")}</Link>
        <Link href="/admin/products">{t("navProducts")}</Link>
        <Link href="/admin/business-accounts">{t("navBusinessAccounts")}</Link>
        <span>
          {account.email} ({account.role})
        </span>
        <form action={logoutAction}>
          <button type="submit">{tAuth("logout")}</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
