import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type { BusinessApprovalStatus } from '@kid-toy/shared-types';

// Deliberately excludes 'PENDING' — a transition back to PENDING is not a
// supported operation of this MINIMAL Phase 1 endpoint (see the header
// comment on BusinessAccountsService.updateApproval).
const TRANSITIONABLE_STATUSES = ['APPROVED', 'REJECTED'] as const;

export class UpdateApprovalDto {
  @ApiProperty({ enum: TRANSITIONABLE_STATUSES })
  @IsEnum(TRANSITIONABLE_STATUSES)
  approvalStatus!: Extract<BusinessApprovalStatus, 'APPROVED' | 'REJECTED'>;

  @ApiPropertyOptional({ description: 'Required when approvalStatus is APPROVED' })
  @IsOptional()
  @IsString()
  priceTierId?: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Required when approvalStatus is REJECTED' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
