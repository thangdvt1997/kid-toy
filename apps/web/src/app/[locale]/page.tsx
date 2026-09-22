import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Home() {
  const t = useTranslations("Home");
  const tCommon = useTranslations("Common");

  return (
    <main style={{ padding: "4rem 2rem", fontFamily: "var(--font-geist-sans)" }}>
      <h1>{t("title")}</h1>
      <p>{t("tagline")}</p>
      <p>
        <Link href="/catalog">{tCommon("catalog")}</Link>
      </p>
    </main>
  );
}
