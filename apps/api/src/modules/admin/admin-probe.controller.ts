import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Proves AUTH-04 (deny-by-default staff RBAC) end to end — not a real
 * admin feature. Every subsequent admin controller in Plans 04-05 and
 * Phases 2-7 must copy this exact pattern: @UseGuards(JwtAuthGuard,
 * RolesGuard) at the class level (authentication first, then
 * authorization) plus an explicit Roles(...) decorator on every route.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/_probe')
export class AdminProbeController {
  @Roles('SUPER_ADMIN')
  @Get('super-admin')
  @ApiOperation({ summary: 'RBAC probe: SUPER_ADMIN only' })
  superAdmin(): { ok: true; scope: 'super-admin' } {
    return { ok: true, scope: 'super-admin' };
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @Get('content')
  @ApiOperation({ summary: 'RBAC probe: SUPER_ADMIN or CONTENT' })
  content(): { ok: true; scope: 'content' } {
    return { ok: true, scope: 'content' };
  }
}
