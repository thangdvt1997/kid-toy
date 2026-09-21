import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { BusinessAccountSummary } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessAccountsService } from './business-accounts.service';
import { ListBusinessAccountsQuery } from './dto/list-business-accounts.query';
import { UpdateApprovalDto } from './dto/update-approval.dto';

/**
 * MINIMAL Phase 1 staff transition — see the header comment on
 * BusinessAccountsService.updateApproval for the scope boundary (Phase 4
 * owns B2B-02's review queue and B2B-03's tier-assignment UI).
 *
 * Copies the exact RBAC pattern documented in AdminProbeController:
 * class-level @UseGuards(JwtAuthGuard, RolesGuard) (authentication first,
 * then authorization) plus an explicit @Roles(...) on every route.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/business-accounts')
export class BusinessAccountsAdminController {
  constructor(private readonly businessAccounts: BusinessAccountsService) {}

  @Roles('SUPER_ADMIN', 'SALES')
  @Get()
  @ApiOperation({ summary: 'List business accounts, optionally filtered by approval status' })
  @ApiResponse({ status: 200, description: 'Business account summaries (no licence key)' })
  async list(@Query() query: ListBusinessAccountsQuery): Promise<BusinessAccountSummary[]> {
    const { items } = await this.businessAccounts.list(query);
    return items;
  }

  @Roles('SUPER_ADMIN', 'SALES')
  @Patch(':id/approval')
  @ApiOperation({ summary: 'Approve a business account onto a price tier, or reject with a reason' })
  @ApiResponse({ status: 200, description: 'Updated business account summary' })
  @ApiResponse({ status: 400, description: 'Missing/invalid tier, or missing rejection reason' })
  async updateApproval(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalDto,
  ): Promise<BusinessAccountSummary> {
    return this.businessAccounts.updateApproval(id, dto);
  }
}
