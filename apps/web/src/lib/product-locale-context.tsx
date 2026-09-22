"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type LocaleSlugMap = Record<"vi" | "en", string> | null;

const SlugContext = createContext<LocaleSlugMap>(null);
const SetSlugContext = createContext<(v: LocaleSlugMap) => void>(() => {});

/**
 * Wraps the whole app (see layout.tsx). Holds the CURRENT product's
 * per-locale slugs so the header's global LocaleSwitcher can build a
 * correct cross-locale link on a product detail page — slugs are
 * per-locale (CATALOG-09) and never cross-resolve, so naively swapping the
 * locale segment of the current URL 404s.
 */
export function ProductLocaleSlugProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<LocaleSlugMap>(null);
  return (
    <SetSlugContext.Provider value={setValue}>
      <SlugContext.Provider value={value}>{children}</SlugContext.Provider>
    </SetSlugContext.Provider>
  );
}

export function useProductLocaleSlugs(): LocaleSlugMap {
  return useContext(SlugContext);
}

/**
 * Rendered (client-side) by the product detail page only. Publishes this
 * product's per-locale slugs into context on mount, and clears them on
 * unmount so navigating to any other page doesn't leak a stale product's
 * slugs into that page's switcher.
 */
export function SyncProductLocaleSlugs({ slugs }: { slugs: LocaleSlugMap }) {
  const setValue = useContext(SetSlugContext);
  useEffect(() => {
    setValue(slugs);
    return () => setValue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the actual slug values, not the (possibly new-identity) object
  }, [setValue, slugs?.vi, slugs?.en]);
  return null;
}
