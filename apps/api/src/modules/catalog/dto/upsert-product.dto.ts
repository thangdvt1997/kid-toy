import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { UpsertTranslationDto } from './upsert-translation.dto';

export const GENDER_VALUES = ['BOY', 'GIRL', 'UNISEX'] as const;
export const CHANNEL_SCOPE_VALUES = ['RETAIL_ONLY', 'WHOLESALE_ONLY', 'BOTH'] as const;

export class UpsertProductDto {
  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiProperty({ minimum: 0, maximum: 18 })
  @IsInt()
  @Min(0)
  @Max(18)
  ageRangeMin!: number;

  @ApiProperty({ minimum: 0, maximum: 18 })
  @IsInt()
  @Min(0)
  @Max(18)
  ageRangeMax!: number;

  @ApiProperty({ enum: GENDER_VALUES })
  @IsEnum(GENDER_VALUES)
  gender!: (typeof GENDER_VALUES)[number];

  @ApiProperty({ maxLength: 80 })
  @IsString()
  origin!: string;

  @ApiProperty({ enum: CHANNEL_SCOPE_VALUES })
  @IsEnum(CHANNEL_SCOPE_VALUES)
  channelScope!: (typeof CHANNEL_SCOPE_VALUES)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [UpsertTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertTranslationDto)
  translations!: UpsertTranslationDto[];
}

/**
 * Partial updates allow one or two translation entries — never zero, never
 * more than two. Creation always requires both locales via
 * assertBothLocales in the service (never enforced here — see
 * upsert-translation.dto.ts for why the array-size rule is NOT expressed
 * as a class-validator constraint).
 */
export class UpdateProductDto extends PartialType(UpsertProductDto) {
  @ApiPropertyOptional({ type: [UpsertTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => UpsertTranslationDto)
  override translations?: UpsertTranslationDto[];
}

export class ListProductsQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
