import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class SetVariantStockDto {
  @ApiProperty({ minimum: 0, example: 120 })
  @IsInt()
  @Min(0)
  quantityOnHand!: number;

  @ApiProperty({ minimum: 0, example: 10 })
  @IsInt()
  @Min(0)
  reorderThreshold!: number;
}
