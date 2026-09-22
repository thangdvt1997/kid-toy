import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/current-user";
import { logoutAction } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const account = await getCurrentUser();
  if (!account) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account`)}`);
  }

  const t = await getTranslations({ locale, namespace: "Auth" });

  return (
    <main>
      <h1>{t("account")}</h1>
      <dl>
        <dt>{t("email")}</dt>
        <dd>{account.email}</dd>
        <dt>{t("accountType")}</dt>
        <dd>{account.type}</dd>
        {account.type === "STAFF" && account.role ? (
          <>
            <dt>{t("staffRole")}</dt>
            <dd>{account.role}</dd>
          </>
        ) : null}
        {account.type === "BUSINESS_ACCOUNT" ? (
          <>
            <dt>{t("approvalStatus")}</dt>
            <dd>{account.approvalStatus}</dd>
          </>
        ) : null}
      </dl>

      {/* PITFALLS.md B2B UX pitfall: a dealer awaiting approval must see an
          explicit state, never silence (T-01-74). */}
      {account.type === "BUSINESS_ACCOUNT" && account.approvalStatus === "PENDING" ? (
        <p role="status">{t("pendingApprovalNotice")}</p>
      ) : null}

      <form action={logoutAction}>
        <button type="submit">{t("logout")}</button>
      </form>
    </main>
  );
}
