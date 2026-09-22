import type { CatalogListItem } from "@kid-toy/shared-types";
import { Link } from "@/i18n/navigation";
import { formatAgeRange } from "@/lib/format";
import PriceTag from "./PriceTag";
import StockBadge from "./StockBadge";

export default function ProductCard({
  item,
  locale,
}: {
  item: CatalogListItem;
  locale: "vi" | "en";
}) {
  return (
    <article>
      {item.primaryImageUrl ? (
        // Plain <img>, not next/image: the source is a short-lived presigned
        // MinIO URL, not a domain we can (or should) pre-register with
        // next/image's remote-pattern allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.primaryImageUrl} alt={item.name} width={160} height={160} loading="lazy" />
      ) : null}
      <h3>
        <Link href={`/catalog/${encodeURIComponent(item.slug)}`}>{item.name}</Link>
      </h3>
      <p>
        {item.brandName ? `${item.brandName} · ` : ""}
        {item.categoryName}
      </p>
      <p>{formatAgeRange(item.ageRangeMin, item.ageRangeMax, locale)}</p>
      <p>{item.origin}</p>
      <PriceTag price={item.price} locale={locale} />
      <StockBadge status={item.stockStatus} />
    </article>
  );
}
