"use client";

import { useTranslations } from "next-intl";

/**
 * Renders a localized error from a message KEY (e.g. "Auth.invalidCredentials",
 * "Common.error") — never raw API text (T-01-73). Renders nothing when no
 * key is provided.
 */
export default function FormError({ messageKey }: { messageKey?: string }) {
  const t = useTranslations();
  if (!messageKey) return null;
  return <p role="alert">{t(messageKey)}</p>;
}
