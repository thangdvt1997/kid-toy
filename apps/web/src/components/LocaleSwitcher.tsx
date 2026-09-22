"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABEL_KEY: Record<(typeof routing.locales)[number], "vietnamese" | "english"> = {
  vi: "vietnamese",
  en: "english",
};

/**
 * Renders one link per configured locale, pointing at the CURRENT path and
 * query string under that locale — a visitor on /vi/catalog?brandId=x&page=2
 * gets an English link to /en/catalog?brandId=x&page=2, not back to /en.
 */
export default function LocaleSwitcher() {
  const currentLocale = useLocale();
  // next-intl's usePathname() returns the locale-agnostic pathname
  // (e.g. "/catalog"), which Link then re-prefixes per the `locale` prop.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const href = query ? `${pathname}?${query}` : pathname;
  const t = useTranslations("Common");

  return (
    <nav aria-label={t("language")}>
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={href}
          locale={locale}
          aria-current={locale === currentLocale ? "true" : undefined}
        >
          {t(LOCALE_LABEL_KEY[locale])}
        </Link>
      ))}
    </nav>
  );
}
