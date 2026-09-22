import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { UpsertTranslationDto } from './upsert-translation.dto';

export class UpsertCategoryDto {
  @ApiPropertyOptional({ description: 'Parent category id — omit for a root category' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [UpsertTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertTranslationDto)
  translations!: UpsertTranslationDto[];
}

/**
 * Partial updates allow ONE OR TWO translation entries (patching a single
 * locale is fine on update) — never zero, never more than two. Creation
 * always requires both locales via assertBothLocales in the service.
 */
export class UpdateCategoryDto extends PartialType(UpsertCategoryDto) {
  @ApiPropertyOptional({ type: [UpsertTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => UpsertTranslationDto)
  override translations?: UpsertTranslationDto[];
}
