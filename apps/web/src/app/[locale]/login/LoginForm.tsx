"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import FormError from "@/components/FormError";
import { loginAction, type ActionState } from "@/lib/auth-actions";

const initialState: ActionState = { ok: false, error: "" };

/**
 * Client form for /[locale]/login. On failure the action returns
 * `{ ok: false, error }` and this component re-renders in place (no
 * navigation happens since the action never calls redirect() on failure) —
 * the uncontrolled email input keeps whatever the user typed.
 */
export default function LoginForm({ next }: { next: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <label>
        {t("email")}
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        {t("password")}
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? t("signingIn") : t("signIn")}
      </button>
      <FormError messageKey={state.ok ? undefined : state.error || undefined} />
      <p>
        {t("noAccount")} <Link href="/register">{t("register")}</Link>
      </p>
      <p>
        <Link href="/register-business">{t("registerBusiness")}</Link>
      </p>
      <p>
        <Link href="/forgot-password">{t("forgotPassword")}</Link>
      </p>
    </form>
  );
}
