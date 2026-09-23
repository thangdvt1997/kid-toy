import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { resolveRedirectTarget } from "@/lib/redirect-target";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("login") };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const t = await getTranslations({ locale, namespace: "Auth" });

  // Validated here too, purely as defense in depth (01-09A Task 2) — the
  // hidden field should never echo a raw, potentially malicious `next`
  // value back into the page source even though React escapes it safely.
  // The REAL enforcement point is loginAction (auth-actions.ts), which
  // re-validates independently: a submitted form can always carry a value
  // different from whatever was rendered here.
  const validatedNext = resolveRedirectTarget(next, locale);

  return (
    <main>
      <h1>{t("login")}</h1>
      <LoginForm next={validatedNext} />
    </main>
  );
}
