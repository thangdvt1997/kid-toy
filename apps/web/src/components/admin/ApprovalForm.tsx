"use client";

import { useActionState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { BusinessAccountSummary, PriceTierDto } from "@kid-toy/shared-types";
import FormError from "@/components/FormError";
import {
  adminInitialState,
  approveBusinessAccountAction,
  getLicenceUrlAction,
  rejectBusinessAccountAction,
} from "@/lib/admin-actions";

/**
 * One row's worth of controls: view licence (via a short-lived presigned
 * URL minted on demand — the object key never reaches this page's HTML,
 * T-01-77), approve onto a non-default tier, or reject with a required
 * reason.
 */
export default function ApprovalForm({
  account,
  tiers,
}: {
  account: BusinessAccountSummary;
  tiers: PriceTierDto[];
}) {
  const t = useTranslations("Admin");
  const [approveState, approveAction, approvePending] = useActionState(
    approveBusinessAccountAction.bind(null, account.id),
    adminInitialState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectBusinessAccountAction.bind(null, account.id),
    adminInitialState,
  );
  const [licencePending, startLicenceTransition] = useTransition();

  const assignableTiers = tiers.filter((tier) => !tier.isDefault);

  function handleViewLicence() {
    startLicenceTransition(async () => {
      const result = await getLicenceUrlAction(account.id);
      if (result.ok && result.data) {
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      }
    });
  }

  return (
    <li>
      <strong>{account.companyName}</strong> — {account.taxId} — {account.businessType} — {account.email}
      <span> ({account.hasLicence ? t("hasLicenceYes") : t("hasLicenceNo")})</span>
      <button type="button" onClick={handleViewLicence} disabled={!account.hasLicence || licencePending}>
        {t("viewLicence")}
      </button>

      {account.approvalStatus === "PENDING" ? (
        <>
          <form action={approveAction}>
            <label>
              {t("tier")}
              <select name="priceTierId" required defaultValue="">
                <option value="" disabled>
                  {t("selectTier")}
                </option>
                {assignableTiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.code} — {tier.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={approvePending}>
              {t("approve")}
            </button>
            <FormError messageKey={approveState.ok ? undefined : approveState.error || undefined} />
          </form>

          <form action={rejectAction}>
            <label>
              {t("rejectionReason")}
              <textarea name="rejectionReason" required />
            </label>
            <button type="submit" disabled={rejectPending}>
              {t("reject")}
            </button>
            <FormError messageKey={rejectState.ok ? undefined : rejectState.error || undefined} />
          </form>
        </>
      ) : (
        <span>
          {account.approvalStatus === "APPROVED" ? t("statusApproved") : t("statusRejected")}
          {account.priceTierCode ? ` (${account.priceTierCode})` : ""}
        </span>
      )}
    </li>
  );
}
