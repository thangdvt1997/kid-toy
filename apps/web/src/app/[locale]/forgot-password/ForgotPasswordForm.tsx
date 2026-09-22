"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FormError from "@/components/FormError";
import { forgotPasswordAction, type ActionState } from "@/lib/auth-actions";

const initialState: ActionState = { ok: false, error: "" };

export default function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);

  if (state.ok) {
    // Byte-identical for a known and an unknown email — no account
    // enumeration signal in the UI (T-01-69).
    return (
      <div role="status">
        <h2>{t("resetLinkSentTitle")}</h2>
        <p>{t("resetLinkSentBody")}</p>
        <p>{t("resetLinkExpiryNote")}</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <label>
        {t("email")}
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <button type="submit" disabled={pending}>
        {t("sendResetLink")}
      </button>
      <FormError messageKey={state.error || undefined} />
      <p>
        <Link href="/login">{t("backToLogin")}</Link>
      </p>
    </form>
  );
}
