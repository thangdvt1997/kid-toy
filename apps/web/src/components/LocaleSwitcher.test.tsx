import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import LocaleSwitcher from "./LocaleSwitcher";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("brandId=x&page=2"),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "vi",
  useTranslations: () => (key: string) => key,
}));

jest.mock("@/i18n/routing", () => ({
  routing: { locales: ["vi", "en"], defaultLocale: "vi" },
}));

// Real next-intl Link/usePathname are exercised by next-intl's own test
// suite; this mock only needs to reproduce the one contract LocaleSwitcher
// relies on — locale-prefixing a given (locale-agnostic) href — so the test
// stays focused on THIS component's own path+query-preservation logic.
jest.mock("@/i18n/navigation", () => ({
  usePathname: () => "/catalog",
  Link: ({
    href,
    locale,
    children,
    ...rest
  }: {
    href: string;
    locale: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={`/${locale}${href}`} {...rest}>
      {children}
    </a>
  ),
}));

describe("LocaleSwitcher", () => {
  it("preserves the current path and query string when switching locale", () => {
    render(<LocaleSwitcher />);

    const englishLink = screen.getByRole("link", { name: "english" });
    expect(englishLink).toHaveAttribute("href", "/en/catalog?brandId=x&page=2");

    const vietnameseLink = screen.getByRole("link", { name: "vietnamese" });
    expect(vietnameseLink).toHaveAttribute("href", "/vi/catalog?brandId=x&page=2");
  });

  it("marks the current locale's link as active", () => {
    render(<LocaleSwitcher />);

    expect(screen.getByRole("link", { name: "vietnamese" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: "english" })).not.toHaveAttribute("aria-current");
  });
});
