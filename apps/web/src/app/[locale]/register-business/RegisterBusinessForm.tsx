"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FormError from "@/components/FormError";
import { registerBusinessAction, type ActionState } from "@/lib/auth-actions";

const initialState: ActionState = { ok: false, error: "" };

export default function RegisterBusinessForm() {
  const t = useTranslations("Auth");
  const tCommon = useTranslations("Common");
  const [state, formAction, pending] = useActionState(registerBusinessAction, initialState);

  if (state.ok) {
    return (
      <div role="status">
        <h2>{t("applicationReceivedTitle")}</h2>
        <p>{t("applicationReceivedBody")}</p>
        <Link href="/catalog">{tCommon("catalog")}</Link>
      </div>
    );
  }

  return (
    <form action={formAction} encType="multipart/form-data">
      <label>
        {t("email")}
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        {t("password")}
        <input type="password" name="password" autoComplete="new-password" minLength={10} required />
        <small>{t("passwordHint")}</small>
      </label>
      <label>
        {t("companyName")}
        <input type="text" name="companyName" required />
      </label>
      <label>
        {t("taxId")}
        <input type="text" name="taxId" required />
      </label>
      <label>
        {t("businessType")}
        <select name="businessType" defaultValue="RETAIL_STORE" required>
          <option value="RETAIL_STORE">{t("businessTypeRetailStore")}</option>
          <option value="SCHOOL">{t("businessTypeSchool")}</option>
          <option value="DISTRIBUTOR">{t("businessTypeDistributor")}</option>
        </select>
      </label>
      <label>
        {t("contactName")}
        <input type="text" name="contactName" />
      </label>
      <label>
        {t("phone")}
        <input type="tel" name="contactPhone" />
      </label>
      <label>
        {t("licence")}
        <input type="file" name="licence" accept=".pdf,.jpg,.jpeg,.png" required />
        <small>{t("licenceHint")}</small>
      </label>
      <button type="submit" disabled={pending}>
        {t("submitApplication")}
      </button>
      <FormError messageKey={state.ok ? undefined : state.error || undefined} />
    </form>
  );
}
