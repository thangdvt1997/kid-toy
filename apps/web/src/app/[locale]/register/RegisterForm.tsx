"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import FormError from "@/components/FormError";
import { registerCustomerAction, type ActionState } from "@/lib/auth-actions";

const initialState: ActionState = { ok: false, error: "" };

/**
 * `minLength={10}` on the password field is a client-side UX convenience
 * only — the API is the real enforcement point (matches the login/reset
 * password forms' documented pattern).
 */
export default function RegisterForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(registerCustomerAction, initialState);

  return (
    <form action={formAction}>
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
        {t("fullName")}
        <input type="text" name="fullName" autoComplete="name" />
      </label>
      <label>
        {t("phone")}
        <input type="tel" name="phone" autoComplete="tel" />
      </label>
      <button type="submit" disabled={pending}>
        {t("createAccount")}
      </button>
      <FormError messageKey={state.ok ? undefined : state.error || undefined} />
    </form>
  );
}
