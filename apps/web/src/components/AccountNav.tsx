import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { logoutAction } from "@/lib/auth-actions";

/**
 * Server component: renders a login link when anonymous, or the account's
 * email + a logout button (+ an admin link for STAFF) when authenticated.
 * `<form action={logoutAction}>` works directly in a Server Component —
 * no client JS needed for logout.
 */
export default async function AccountNav() {
  const t = await getTranslations("Auth");
  const account = await getCurrentUser();

  if (!account) {
    return <Link href="/login">{t("login")}</Link>;
  }

  return (
    <span>
      <span>{account.email}</span>
      {account.type === "STAFF" ? <Link href="/admin">{t("adminConsole")}</Link> : null}
      <Link href="/account">{t("account")}</Link>
      <form action={logoutAction} style={{ display: "inline" }}>
        <button type="submit">{t("logout")}</button>
      </form>
    </span>
  );
}
