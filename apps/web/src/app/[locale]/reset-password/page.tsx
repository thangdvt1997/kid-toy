import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("resetPasswordTitle") };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  const t = await getTranslations({ locale, namespace: "Auth" });

  if (!token) {
    // No token param renders the invalid-token state immediately, never an
    // empty form.
    return (
      <main>
        <h1>{t("resetPasswordTitle")}</h1>
        <p role="alert">{t("resetTokenInvalid")}</p>
        <p>
          <Link href="/forgot-password">{t("forgotPasswordTitle")}</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{t("resetPasswordTitle")}</h1>
      <ResetPasswordForm token={token} />
    </main>
  );
}
