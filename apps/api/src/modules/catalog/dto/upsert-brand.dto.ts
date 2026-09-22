import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpsertBrandDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code', example: 'VN' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'originCountry must be an ISO 3166-1 alpha-2 code' })
  originCountry?: string;
}

export class UpdateBrandDto extends PartialType(UpsertBrandDto) {}
