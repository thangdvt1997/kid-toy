import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { BusinessType } from '@kid-toy/shared-types';

const BUSINESS_TYPE_VALUES = ['RETAIL_STORE', 'SCHOOL', 'DISTRIBUTOR'] as const;

export class RegisterBusinessDto {
  @ApiProperty({ example: 'dealer@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Str0ng-Passw0rd!', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Cua Hang Do Choi ABC', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  companyName!: string;

  @ApiProperty({
    example: '0101010101',
    description: 'Vietnamese tax ID (ma so thue): 10 digits, optional 3-digit branch suffix',
  })
  @Matches(/^\d{10}(-\d{3})?$/, {
    message: 'taxId must be a valid Vietnamese tax code (10 digits, optional 3-digit branch suffix)',
  })
  taxId!: string;

  @ApiProperty({ enum: BUSINESS_TYPE_VALUES })
  @IsEnum(BUSINESS_TYPE_VALUES)
  businessType!: BusinessType;

  @ApiPropertyOptional({ example: 'Nguyen Van A' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional({ example: '0912345678' })
  @IsOptional()
  @Matches(/^0\d{9,10}$/, { message: 'contactPhone must be a valid Vietnamese phone number' })
  contactPhone?: string;

  // Multipart file field — validated by buildFileValidationPipe via
  // @UploadedFile() in the controller, not by class-validator. Declared here
  // only so Swagger documents it as part of the multipart/form-data body.
  // @IsOptional() is required even though this is never actually validated:
  // with tsconfig's ES2023 target, `useDefineForClassFields` makes every
  // bare class field (even unassigned) an own `undefined`-valued property on
  // the transformed DTO instance. The global ValidationPipe's
  // `whitelist: true` + `forbidNonWhitelisted: true` rejects any own
  // property with zero class-validator decorator metadata as "should not
  // exist" — so every register call failed with 400, file attached or not,
  // until this class knows about `licence` at all via at least one decorator.
  @ApiProperty({ type: 'string', format: 'binary' })
  @IsOptional()
  licence?: unknown;
}
