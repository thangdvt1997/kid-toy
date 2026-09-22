import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertCertificationDto {
  @ApiProperty({ maxLength: 100, description: 'QCVN safety certificate number' })
  @IsString()
  @MaxLength(100)
  certNumber!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  issuingBody!: string;

  @ApiProperty()
  @IsISO8601()
  validFrom!: string;

  @ApiProperty()
  @IsISO8601()
  validTo!: string;

  // Free-text placeholder in Phase 1 — Phase 2 replaces this with a real
  // StockLot foreign key once batch-tracked inventory exists.
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchLabel?: string;
}
