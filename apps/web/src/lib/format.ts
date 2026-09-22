/**
 * VND is stored and transmitted as an integer (no decimal places) but as a
 * STRING on the wire (see CatalogPrice.unitPriceVnd in @kid-toy/shared-types)
 * because a raw number can silently lose precision for large values.
 * Formatting MUST go through BigInt — never `Number(unitPriceVnd)` — so a
 * 15-digit price still renders exactly, with no `e+14` scientific notation.
 */
export function formatVnd(unitPriceVnd: string, locale: "vi" | "en"): string {
  const amount = BigInt(unitPriceVnd);
  const formatted = new Intl.NumberFormat(
    locale === "vi" ? "vi-VN" : "en-US",
  ).format(amount);
  return `${formatted} ₫`;
}

export function formatAgeRange(
  min: number,
  max: number,
  locale: "vi" | "en",
): string {
  return locale === "vi" ? `${min}-${max} tuổi` : `Ages ${min}-${max}`;
}
