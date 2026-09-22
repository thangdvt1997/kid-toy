import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GENDER_VALUES } from './upsert-product.dto';

export const CATALOG_LOCALE_VALUES = ['vi', 'en'] as const;
export const CATALOG_SORT_VALUES = ['name_asc', 'name_desc', 'newest'] as const;

/**
 * Validated facet filters for the public catalog read path (CATALOG-07).
 * Every field carries at least one class-validator decorator, including
 * optional/placeholder fields — under this codebase's global
 * `whitelist: true, forbidNonWhitelisted: true` ValidationPipe on
 * `useDefineForClassFields` (ES2023), a bare class field with zero
 * validator metadata is a landmine (see 01-06 lessons).
 */
export class BrowseCatalogQuery {
  @ApiPropertyOptional({ enum: CATALOG_LOCALE_VALUES })
  @IsOptional()
  @IsIn(CATALOG_LOCALE_VALUES)
  locale?: (typeof CATALOG_LOCALE_VALUES)[number];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 24, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize: number = 24;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  origin?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 18 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(18)
  ageMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 18 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(18)
  ageMax?: number;

  @ApiPropertyOptional({ enum: GENDER_VALUES })
  @IsOptional()
  @IsEnum(GENDER_VALUES)
  gender?: (typeof GENDER_VALUES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: CATALOG_SORT_VALUES, default: 'newest' })
  @IsOptional()
  @IsIn(CATALOG_SORT_VALUES)
  sort: (typeof CATALOG_SORT_VALUES)[number] = 'newest';
}
