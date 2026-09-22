import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const LOCALES = ['vi', 'en'] as const;
export type LocaleInput = (typeof LOCALES)[number];

/**
 * One locale's worth of translatable content for a category or product.
 * Reused (never redefined) by both taxonomy and product DTOs so the
 * bilingual-content rule cannot drift between the two — see
 * assertBothLocales below.
 */
export class UpsertTranslationDto {
  @ApiProperty({ enum: LOCALES })
  @IsIn(LOCALES)
  locale!: LocaleInput;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    maxLength: 200,
    description: 'Lowercase, hyphen-separated slug — unique per locale, not globally.',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric with single hyphen separators',
  })
  @MaxLength(200)
  slug!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

/**
 * Throws BadRequestException('BOTH_LOCALES_REQUIRED') unless `translations`
 * contains EXACTLY one `vi` entry and EXACTLY one `en` entry. This is the
 * single enforcement point for CATALOG-09's "both locales mandatory at
 * write time" rule — categories and products both call this instead of
 * re-deriving the check, so the rule cannot drift between the two.
 *
 * Deliberately NOT enforced via @ArrayMinSize/@ArrayMaxSize on the DTO:
 * class-validator's own array-size violation produces a generic
 * "translations must contain ... elements" message, not the stable
 * BOTH_LOCALES_REQUIRED code this plan's acceptance criteria require in
 * the response body. Keeping the check here (service-level, on every
 * create path) guarantees the exact code regardless of how the array is
 * malformed (too few, too many, or a duplicate locale).
 */
export function assertBothLocales(translations: UpsertTranslationDto[] | undefined): void {
  if (!translations || translations.length !== 2) {
    throw new BadRequestException('BOTH_LOCALES_REQUIRED');
  }
  const hasVi = translations.filter((t) => t.locale === 'vi').length === 1;
  const hasEn = translations.filter((t) => t.locale === 'en').length === 1;
  if (!hasVi || !hasEn) {
    throw new BadRequestException('BOTH_LOCALES_REQUIRED');
  }
}
