import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import RegisterForm from "./RegisterForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("createAccount") };
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });

  return (
    <main>
      <h1>{t("createAccount")}</h1>
      <RegisterForm />
      <p>
        {t("haveAccount")} <Link href="/login">{t("login")}</Link>
      </p>
    </main>
  );
}
