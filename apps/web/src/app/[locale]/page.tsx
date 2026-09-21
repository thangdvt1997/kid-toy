import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("Home");

  return (
    <main style={{ padding: "4rem 2rem", fontFamily: "var(--font-geist-sans)" }}>
      <h1>{t("title")}</h1>
      <p>{t("tagline")}</p>
    </main>
  );
}
