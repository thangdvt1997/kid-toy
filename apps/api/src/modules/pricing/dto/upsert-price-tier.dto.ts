import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * `isDefault` is intentionally NOT a field on this DTO — exactly one
 * default tier exists and it is seeded (RETAIL). The global ValidationPipe
 * (`whitelist: true`, `forbidNonWhitelisted: true`) rejects any request
 * body that attempts to set it, so it can never be accepted from a client
 * regardless of controller/service logic.
 */
export class UpsertPriceTierDto {
  @ApiProperty({ example: 'DEALER_C', description: 'Uppercase letters/digits/underscore, 3-32 chars' })
  @Matches(/^[A-Z][A-Z0-9_]{2,31}$/, {
    message: 'code must start with an uppercase letter and contain only A-Z, 0-9, _ (3-32 chars total)',
  })
  code!: string;

  @ApiProperty({ maxLength: 120, example: 'Đại lý cấp C' })
  @IsString()
  @MaxLength(120)
  name!: string;
}
