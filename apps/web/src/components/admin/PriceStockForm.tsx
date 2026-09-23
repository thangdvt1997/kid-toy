"use client";

import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { PriceEntryDto, PriceTierDto, VariantStockDto } from "@kid-toy/shared-types";
import FormError from "@/components/FormError";
import StockBadge from "@/components/StockBadge";
import {
  adminInitialState,
  deletePriceEntryAction,
  setPriceAction,
  setStockAction,
  type ActionState,
} from "@/lib/admin-actions";

/**
 * Price rows (per tier, `unitPriceVnd` constrained to digits and forwarded
 * as a STRING — see setPriceAction's own comment for why `Number(...)` is
 * never applied) plus a separate stock fieldset. When the current staff
 * role cannot perform an action, the section still renders — only the
 * SUBMIT reveals the role boundary via the action's own 403 mapping,
 * because there is no admin GET for current stock levels to gate
 * visibility on (VariantStockService is a deliberately thin Phase 1 stub —
 * see 01-06-SUMMARY.md).
 */
export default function PriceStockForm({
  productId,
  variantId,
  tiers,
  entries,
  priceForbidden,
}: {
  productId: string;
  variantId: string;
  tiers: PriceTierDto[];
  entries: PriceEntryDto[];
  priceForbidden: boolean;
}) {
  const t = useTranslations("Admin");
  const [priceState, priceFormAction, pricePending] = useActionState(
    setPriceAction.bind(null, productId, variantId),
    adminInitialState,
  );
  const [stockState, stockFormAction, stockPending] = useActionState<ActionState<VariantStockDto>, FormData>(
    setStockAction.bind(null, productId, variantId),
    adminInitialState,
  );
  const [isPending, startTransition] = useTransition();

  function handleDeleteEntry(entryId: string) {
    startTransition(async () => {
      await deletePriceEntryAction(productId, entryId);
    });
  }

  return (
    <section>
      <h4>{t("pricingTitle")}</h4>
      {priceForbidden ? (
        <p role="alert">{t("priceForbiddenNotice")}</p>
      ) : (
        <>
          {entries.length > 0 ? (
            <ul>
              {entries.map((entry) => (
                <li key={entry.id}>
                  {entry.tierCode} — {t("minQty")}: {entry.minQty} — {entry.unitPriceVnd} ₫
                  <button type="button" onClick={() => handleDeleteEntry(entry.id)} disabled={isPending}>
                    {t("delete")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form action={priceFormAction}>
            <label>
              {t("tier")}
              <select name="tierId" required>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.code} — {tier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("minQty")}
              <input type="number" name="minQty" min={1} defaultValue={1} required />
            </label>
            <label>
              {t("unitPriceVnd")}
              <input type="text" name="unitPriceVnd" inputMode="numeric" pattern="\d*" required />
            </label>
            <button type="submit" disabled={pricePending}>
              {t("save")}
            </button>
            <FormError messageKey={priceState.ok ? undefined : priceState.error || undefined} />
          </form>
        </>
      )}

      <h4>{t("stockTitle")}</h4>
      <form action={stockFormAction}>
        <label>
          {t("quantityOnHand")}
          <input type="number" name="quantityOnHand" min={0} required />
        </label>
        <label>
          {t("reorderThreshold")}
          <input type="number" name="reorderThreshold" min={0} required />
        </label>
        <button type="submit" disabled={stockPending}>
          {t("save")}
        </button>
        <FormError messageKey={stockState.ok ? undefined : stockState.error || undefined} />
        {stockState.ok && stockState.data ? <StockBadge status={stockState.data.status} /> : null}
      </form>
    </section>
  );
}
