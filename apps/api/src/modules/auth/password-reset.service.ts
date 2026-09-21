import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../notifications/mailer.service';
import { TokenService } from './token.service';

const RAW_TOKEN_BYTES = 32;

/**
 * Single-use, hashed, TTL-bounded password reset tokens. See RESEARCH.md
 * "Don't Hand-Roll" and threats T-01-29 (replay), T-01-30 (enumeration).
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Always resolves — the controller returns 202 regardless of whether the
   * account exists, so this method must never throw or signal existence
   * via timing/response shape (T-01-30: account enumeration).
   */
  async request(email: string, locale: 'vi' | 'en' = 'vi'): Promise<void> {
    const account = await this.prisma.account.findUnique({ where: { email } });
    if (!account || !account.isActive) {
      return;
    }

    const now = new Date();
    // A second request supersedes the first — mark every existing unused,
    // unexpired token for this account as used before minting a new one.
    await this.prisma.passwordResetToken.updateMany({
      where: { accountId: account.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    const raw = randomBytes(RAW_TOKEN_BYTES).toString('hex');
    const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

    await this.prisma.passwordResetToken.create({
      data: { accountId: account.id, tokenHash: this.hash(raw), expiresAt },
    });

    const baseUrl = this.config.get('APP_BASE_URL', { infer: true });
    const resetUrl = `${baseUrl}/${locale}/reset-password?token=${raw}`;
    await this.mailer.sendPasswordReset(account.email, resetUrl, locale);
  }

  async reset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hash(rawToken);
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    // ONE identical error for unknown, used, and expired — no distinguishing
    // information leaked to the caller (mirrors the byte-identical 401
    // pattern in AuthService.validateCredentials).
    if (!row || row.usedAt !== null || row.expiresAt <= new Date()) {
      throw new BadRequestException('INVALID_OR_EXPIRED_TOKEN');
    }

    const cost = this.config.get('BCRYPT_COST', { infer: true });
    const passwordHash = await bcrypt.hash(newPassword, cost);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      await tx.account.update({ where: { id: row.accountId }, data: { passwordHash } });
    });

    // ASVS V3: a password change revokes all outstanding sessions.
    await this.tokenService.revokeAllForAccount(row.accountId);
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
