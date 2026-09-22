"use server";

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AuthenticatedAccount, AuthTokens } from "@kid-toy/shared-types";
import { apiSend, ApiError } from "./api-client";
import { clearSession, getAccessToken, setSession } from "./session";

export type ActionState = { ok: true } | { ok: false; error: string };

function isNonEmptyString(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && value.length > 0;
}

export type SessionLoginResult =
  | { ok: true; account: AuthenticatedAccount }
  | { ok: false; status: 401 | 502; error: string };

/**
 * Single source of truth for exchanging credentials for a session — the
 * ONLY place that calls POST /api/auth/login and writes the resulting
 * cookies. Called directly (not via a nested self-fetch) by both
 * `/api/session`'s route handler and `loginAction` below: next/headers'
 * cookies() is scoped to the current request's AsyncLocalStorage context,
 * so a nested fetch() to our own /api/session route would set cookies on
 * an unrelated internal Response the browser never sees. A direct function
 * call keeps every cookie write on the real outgoing response, whichever
 * entry point triggered it.
 */
export async function exchangeCredentialsForSession(
  email: string,
  password: string,
): Promise<SessionLoginResult> {
  try {
    const result = await apiSend<AuthTokens & { account: AuthenticatedAccount }>(
      "POST",
      "/api/auth/login",
      { email, password },
    );
    await setSession(result);
    return { ok: true, account: result.account };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return { ok: false, status: 401, error: "Auth.invalidCredentials" };
    }
    return { ok: false, status: 502, error: "Common.error" };
  }
}

/**
 * `useActionState`-shaped Server Action for the login form. On success it
 * redirects (never returns `{ ok: true }`) — the form component only ever
 * needs to render the error branch.
 */
export async function loginAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const next = formData.get("next");
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return { ok: false, error: "Auth.invalidCredentials" };
  }

  const result = await exchangeCredentialsForSession(email, password);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const locale = await getLocale();
  const destination = isNonEmptyString(next) ? next : `/${locale}/account`;
  redirect(destination);
}

/** Revokes the account's outstanding refresh tokens (best-effort) and always clears the local session. */
export async function logoutAction(): Promise<void> {
  const token = await getAccessToken();
  if (token) {
    try {
      await apiSend<void>("POST", "/api/auth/logout", undefined, { auth: true });
    } catch {
      // Best-effort — always clear the local session regardless.
    }
  }
  await clearSession();
  const locale = await getLocale();
  redirect(`/${locale}`);
}

// ---------------------------------------------------------------------
// Task 2 — retail and B2B registration (AUTH-02, AUTH-03)
// ---------------------------------------------------------------------

/**
 * Registers a retail customer, logs them in immediately (the API returns
 * tokens just like login), and redirects to /[locale]/account. Client
 * `minLength={10}` on the password field is a UX convenience only — the API
 * is the actual enforcement point, exactly as it is for login.
 */
export async function registerCustomerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const fullName = formData.get("fullName");
  const phone = formData.get("phone");
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return { ok: false, error: "Auth.invalidInput" };
  }

  const body: Record<string, string> = { email, password };
  if (isNonEmptyString(fullName)) body.fullName = fullName;
  if (isNonEmptyString(phone)) body.phone = phone;

  let result: AuthTokens & { account: AuthenticatedAccount };
  try {
    result = await apiSend<AuthTokens & { account: AuthenticatedAccount }>(
      "POST",
      "/api/auth/register",
      body,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { ok: false, error: "Auth.emailTaken" };
    }
    if (err instanceof ApiError && err.status === 400) {
      return { ok: false, error: "Auth.invalidInput" };
    }
    return { ok: false, error: "Common.error" };
  }

  await setSession(result);
  const locale = await getLocale();
  redirect(`/${locale}/account`);
}

/**
 * Registers a B2B business account. Deliberately does NOT call setSession —
 * a PENDING business account is not an active session (T-01-74). Returns
 * `{ ok: true }` on success so the form can render the pending-approval
 * panel instead of redirecting anywhere.
 */
export async function registerBusinessAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const licence = formData.get("licence");
  if (!(licence instanceof File) || licence.size === 0) {
    return { ok: false, error: "Auth.invalidInput" };
  }

  const payload = new FormData();
  const textFields = [
    "email",
    "password",
    "companyName",
    "taxId",
    "businessType",
    "contactName",
    "contactPhone",
  ] as const;
  for (const field of textFields) {
    const value = formData.get(field);
    if (isNonEmptyString(value)) {
      payload.set(field, value);
    }
  }
  payload.set("licence", licence);

  try {
    await apiSend<{ accountId: string; approvalStatus: "PENDING" }>(
      "POST",
      "/api/business-accounts/register",
      undefined,
      { formData: payload },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      if (err.message.includes("TAX_ID_TAKEN")) return { ok: false, error: "Auth.taxIdTaken" };
      if (err.message.includes("EMAIL_TAKEN")) return { ok: false, error: "Auth.emailTaken" };
      return { ok: false, error: "Auth.invalidInput" };
    }
    if (err instanceof ApiError && err.status === 400) {
      return { ok: false, error: "Auth.invalidInput" };
    }
    return { ok: false, error: "Common.error" };
  }
}

// ---------------------------------------------------------------------
// Task 3 — forgot/reset password (AUTH-05)
// ---------------------------------------------------------------------

/**
 * Always resolves to `{ ok: true }` for any non-5xx outcome — the UI must
 * never distinguish a known email from an unknown one (T-01-69). The
 * forgot-password API returns 202 with no body on success; any other error
 * shape short of a real server failure is still treated as the uniform
 * success case.
 */
export async function forgotPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = formData.get("email");
  if (!isNonEmptyString(email)) {
    return { ok: true };
  }
  const locale = await getLocale();
  try {
    await apiSend<void>("POST", "/api/auth/forgot-password", { email, locale });
  } catch (err) {
    if (err instanceof ApiError && err.status >= 500) {
      return { ok: false, error: "Common.error" };
    }
    // Any other outcome is still the uniform success case.
  }
  return { ok: true };
}

/**
 * Validates password/passwordConfirm match BEFORE calling the API — a
 * mismatch never issues a network request. Maps every invalid/expired/used
 * token outcome to the SAME message key (T-01-70).
 */
export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = formData.get("token");
  const password = formData.get("password");
  const passwordConfirm = formData.get("passwordConfirm");
  if (!isNonEmptyString(token) || !isNonEmptyString(password) || !isNonEmptyString(passwordConfirm)) {
    return { ok: false, error: "Auth.invalidInput" };
  }
  if (password !== passwordConfirm) {
    return { ok: false, error: "Auth.passwordMismatch" };
  }

  try {
    await apiSend<void>("POST", "/api/auth/reset-password", { token, password });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      return { ok: false, error: "Auth.resetTokenInvalid" };
    }
    return { ok: false, error: "Common.error" };
  }
}
