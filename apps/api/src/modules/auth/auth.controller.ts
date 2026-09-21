import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedAccount, AuthTokens } from '@kid-toy/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { PrismaService } from '../../prisma/prisma.service';
import { buildJwtPayload, type AccountWithRelations } from './account-payload.util';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';
import { TokenService } from './token.service';

// Tighter than the global 120/min ThrottlerModule default — mitigates
// credential stuffing / brute force (threat T-01-14). Overridable via
// AUTH_THROTTLE_LIMIT so automated e2e suites (many sequential logins from
// one client) aren't rate-limited; unset in production/dev, so the secure
// default of 5/min always applies there.
const AUTH_THROTTLE_LIMIT = Number(process.env.AUTH_THROTTLE_LIMIT) || 5;
const AUTH_THROTTLE = { default: { limit: AUTH_THROTTLE_LIMIT, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Register a new retail customer account' })
  @ApiResponse({ status: 201, description: 'Account created, tokens issued' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterCustomerDto,
  ): Promise<AuthTokens & { account: AuthenticatedAccount }> {
    const account = await this.authService.registerCustomer(dto);
    return this.authService.login(account);
  }

  @Throttle(AUTH_THROTTLE)
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({ status: 200, description: 'Tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() _dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthTokens & { account: AuthenticatedAccount }> {
    const account = req.user as AccountWithRelations;
    return this.authService.login(account);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new access/refresh pair' })
  @ApiResponse({ status: 200, description: 'New tokens issued' })
  @ApiResponse({ status: 401, description: 'Invalid, revoked, or expired refresh token' })
  async refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.tokenService.rotateRefreshToken(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke every outstanding refresh token for the current account' })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.tokenService.revokeAllForAccount(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Return the current authenticated account' })
  @ApiResponse({ status: 200, description: 'Current account' })
  async me(@CurrentUser() user: JwtPayload): Promise<AuthenticatedAccount> {
    // Re-reads from the database rather than trusting the token body alone.
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: user.sub },
      include: { staffProfile: true, customerProfile: true, businessAccount: true },
    });
    const payload = buildJwtPayload(account);
    return this.authService.toSafeAccount(account, payload);
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request a password reset link',
    description: 'Always returns 202, even for an unknown email — no account enumeration.',
  })
  @ApiResponse({ status: 202, description: 'Reset request accepted (always)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordResetService.request(dto.email, dto.locale ?? 'vi');
  }

  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  @ApiOperation({ summary: 'Complete a password reset using a single-use token' })
  @ApiResponse({ status: 204, description: 'Password updated; all sessions revoked' })
  @ApiResponse({ status: 400, description: 'Invalid, used, or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordResetService.reset(dto.token, dto.password);
  }
}
