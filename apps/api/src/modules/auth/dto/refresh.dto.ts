import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'Raw 64-hex-char refresh token' })
  @IsString()
  @Length(64, 64)
  refreshToken!: string;
}
