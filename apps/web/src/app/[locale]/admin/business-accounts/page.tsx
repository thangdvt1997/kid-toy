import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { BusinessAccountSummary, PriceTierDto } from "@kid-toy/shared-types";
import { apiGet } from "@/lib/api-client";
import { requireStaff } from "@/lib/current-user";
import { Link } from "@/i18n/navigation";
import ApprovalForm from "@/components/admin/ApprovalForm";

export const dynamic = "force-dynamic";

type Locale = "vi" | "en";
type Status = "PENDING" | "APPROVED" | "REJECTED";
const STATUSES: Status[] = ["PENDING", "APPROVED", "REJECTED"];
const STATUS_LABEL_KEY: Record<Status, "statusPending" | "statusApproved" | "statusRejected"> = {
  PENDING: "statusPending",
  APPROVED: "statusApproved",
  REJECTED: "statusRejected",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  return { title: t("businessAccountsTitle") };
}

/**
 * Lists business accounts filtered by status (default PENDING) and
 * provides the approve/reject loop that closes AUTH-03's registration
 * flow. `requireStaff(['SUPER_ADMIN','SALES'])` narrows the layout's
 * broader staff-only gate to the two roles the API's own
 * BusinessAccountsAdminController.@Roles(...) accepts.
 */
export default async function BusinessAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  await requireStaff(["SUPER_ADMIN", "SALES"]);
  const t = await getTranslations({ locale, namespace: "Admin" });

  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "PENDING";

  const [accounts, tiers] = await Promise.all([
    apiGet<BusinessAccountSummary[]>("/api/admin/business-accounts", {
      searchParams: { status },
      auth: true,
    }),
    apiGet<PriceTierDto[]>("/api/admin/price-tiers", { auth: true }),
  ]);

  return (
    <main>
      <h1>{t("businessAccountsTitle")}</h1>
      <nav aria-label={t("statusFilter")}>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/business-accounts?status=${s}`} aria-current={s === status}>
            {t(STATUS_LABEL_KEY[s])}
          </Link>
        ))}
      </nav>
      {accounts.length === 0 ? (
        <p>{t("noResults")}</p>
      ) : (
        <ul>
          {accounts.map((account) => (
            <ApprovalForm key={account.id} account={account} tiers={tiers} />
          ))}
        </ul>
      )}
    </main>
  );
}
