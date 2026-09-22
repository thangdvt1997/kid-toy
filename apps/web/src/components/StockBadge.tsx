import { useTranslations } from "next-intl";
import type { StockStatus } from "@kid-toy/shared-types";

const LABEL_KEY: Record<StockStatus, "inStock" | "lowStock" | "outOfStock"> = {
  IN_STOCK: "inStock",
  LOW_STOCK: "lowStock",
  OUT_OF_STOCK: "outOfStock",
};

/**
 * Three-state stock indicator (CATALOG-08). `data-status` carries the raw
 * enum for styling/testing hooks; the visible text is the localized label
 * itself — never colour-only signalling (PITFALLS.md UX pitfall).
 */
export default function StockBadge({ status }: { status: StockStatus }) {
  const t = useTranslations("Product");
  return <span data-status={status}>{t(LABEL_KEY[status])}</span>;
}
