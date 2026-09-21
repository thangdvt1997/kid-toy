import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw reset token (64 hex chars) delivered via the reset link' })
  @IsString()
  @Length(64, 64)
  token!: string;

  @ApiProperty({ minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}
