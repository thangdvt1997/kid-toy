import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import AccountNav from "./AccountNav";
import LocaleSwitcher from "./LocaleSwitcher";

export default async function SiteHeader() {
  const t = await getTranslations("Common");

  return (
    <header>
      <Link href="/">{t("siteName")}</Link>
      <nav>
        <Link href="/catalog">{t("catalog")}</Link>
      </nav>
      <AccountNav />
      <LocaleSwitcher />
    </header>
  );
}
