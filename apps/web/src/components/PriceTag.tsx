import { useTranslations } from "next-intl";
import type { CatalogPrice } from "@kid-toy/shared-types";
import { formatVnd } from "@/lib/format";

/**
 * Renders the viewer-resolved price as-is (never arithmetic on
 * `unitPriceVnd` — it is formatted, not computed, here). When the resolved
 * tier isn't RETAIL, also shows the tier code so an approved dealer can see
 * which price list produced the number (CATALOG-06).
 */
export default function PriceTag({
  price,
  locale,
}: {
  price: CatalogPrice | null;
  locale: "vi" | "en";
}) {
  const t = useTranslations("Product");

  if (!price) {
    return <span>{t("priceUnavailable")}</span>;
  }

  return (
    <span>
      {formatVnd(price.unitPriceVnd, locale)}
      {price.tierCode !== "RETAIL" ? (
        <span data-tier={price.tierCode}> ({price.tierCode})</span>
      ) : null}
    </span>
  );
}
