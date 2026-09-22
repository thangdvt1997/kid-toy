import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Min } from 'class-validator';

export class UpsertPriceEntryDto {
  @ApiProperty()
  @IsString()
  tierId!: string;

  @ApiProperty({ minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  minQty!: number;

  /**
   * A decimal STRING, never a JSON number — JSON numbers lose precision on
   * large integers and invite float money (T-01-44). Parsed to `BigInt` in
   * the service, never `Number()`.
   */
  @ApiProperty({ example: '450000', description: 'Decimal VND string (digits only, max 15 digits)' })
  @Matches(/^\d{1,15}$/, {
    message: 'unitPriceVnd must be a decimal string of digits only, no sign or decimal point (max 15 digits)',
  })
  unitPriceVnd!: string;
}
