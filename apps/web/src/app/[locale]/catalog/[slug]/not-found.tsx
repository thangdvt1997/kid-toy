import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * `not-found.js` components receive no props (Next.js file-convention
 * constraint), so the locale is resolved the same way any other Server
 * Component under `[locale]/layout.tsx` resolves it: next-intl's request-
 * scoped context, already established by the time this segment renders.
 */
export default function ProductNotFound() {
  const t = useTranslations("Product");

  return (
    <main>
      <h1>{t("notFound")}</h1>
      <p>
        <Link href="/catalog">{t("backToCatalog")}</Link>
      </p>
    </main>
  );
}
