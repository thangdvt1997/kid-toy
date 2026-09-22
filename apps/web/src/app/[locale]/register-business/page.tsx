import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import RegisterBusinessForm from "./RegisterBusinessForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });
  return { title: t("registerBusiness") };
}

export default async function RegisterBusinessPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Auth" });

  return (
    <main>
      <h1>{t("registerBusiness")}</h1>
      <RegisterBusinessForm />
    </main>
  );
}
