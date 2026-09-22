import { ApiPropertyOptional, ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpsertVariantDto {
  @ApiProperty({ description: 'Uppercase alphanumeric with dashes, 3-32 chars', example: 'KT-EDU-003' })
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,31}$/, {
    message: 'sku must be 3-32 uppercase alphanumeric characters/dashes',
  })
  sku!: string;

  @ApiPropertyOptional({ description: 'EAN-8/EAN-13/ITF-14 digit range', example: '8938500000099' })
  @IsOptional()
  @Matches(/^\d{8,14}$/, { message: 'barcode must be 8-14 digits' })
  barcode?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  variantLabel?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerInnerBox?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerMasterCarton?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cartonLengthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cartonWidthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cartonHeightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(10000)
  cartonWeightKg?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVariantDto extends PartialType(UpsertVariantDto) {}
