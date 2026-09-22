"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FormError from "@/components/FormError";
import { resetPasswordAction, type ActionState } from "@/lib/auth-actions";

const initialState: ActionState = { ok: false, error: "" };

export default function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  if (state.ok) {
    return (
      <div role="status">
        <h2>{t("resetSuccessTitle")}</h2>
        <p>{t("resetSuccessBody")}</p>
        <Link href="/login">{t("backToLogin")}</Link>
      </div>
    );
  }

  return (
    <form action={formAction}>
      {/* Never rendered as visible text — carried only as the hidden field's
          value attribute, never logged (T-01-70). */}
      <input type="hidden" name="token" value={token} />
      <label>
        {t("newPassword")}
        <input type="password" name="password" autoComplete="new-password" minLength={10} required />
      </label>
      <label>
        {t("confirmPassword")}
        <input
          type="password"
          name="passwordConfirm"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {t("resetPasswordTitle")}
      </button>
      <FormError messageKey={state.error || undefined} />
    </form>
  );
}
