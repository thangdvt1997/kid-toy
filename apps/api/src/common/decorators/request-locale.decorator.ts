import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Locale resolution for the public catalog read path (CATALOG-09).
 * Precedence: explicit `?locale=` query value -> `Accept-Language` header's
 * first supported tag -> `'vi'` (the primary market, see 01-RESEARCH.md
 * Assumption A1). An explicit `?locale=` value outside the supported set
 * throws 400 — a wrong/typo'd query param must never silently fall back.
 */
export const SUPPORTED_LOCALES = ['vi', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function toPrismaLocale(locale: AppLocale): 'VI' | 'EN' {
  return locale === 'vi' ? 'VI' : 'EN';
}

function isSupportedLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Parses an `Accept-Language` header, returning the first supported tag's primary subtag. */
function localeFromAcceptLanguage(
  header: string | string[] | undefined,
): AppLocale | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    return undefined;
  }
  const tags = raw
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase())
    .filter((tag): tag is string => Boolean(tag));
  for (const tag of tags) {
    const primary = tag.split('-')[0];
    if (primary && isSupportedLocale(primary)) {
      return primary;
    }
  }
  return undefined;
}

export const RequestLocale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppLocale => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const rawQueryLocale = (
      request.query as Record<string, unknown> | undefined
    )?.locale;

    if (rawQueryLocale !== undefined) {
      const value = Array.isArray(rawQueryLocale)
        ? (rawQueryLocale as unknown[])[0]
        : rawQueryLocale;
      if (typeof value !== 'string' || !isSupportedLocale(value)) {
        throw new BadRequestException('UNSUPPORTED_LOCALE');
      }
      return value;
    }

    return localeFromAcceptLanguage(request.headers['accept-language']) ?? 'vi';
  },
);
