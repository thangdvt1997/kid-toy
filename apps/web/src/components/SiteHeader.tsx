import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import LocaleSwitcher from "./LocaleSwitcher";

export default function SiteHeader() {
  const t = useTranslations("Common");

  return (
    <header>
      <Link href="/">{t("siteName")}</Link>
      <nav>
        <Link href="/catalog">{t("catalog")}</Link>
      </nav>
      {/* Plan 09 inserts login/account links (retail + B2B session UI) here. */}
      <LocaleSwitcher />
    </header>
  );
}
