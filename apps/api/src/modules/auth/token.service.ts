import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { buildJwtPayload } from './account-payload.util';
import { parseDurationMs } from './duration.util';

/**
 * Issues short-lived access JWTs (HS256, algorithm pinned) and rotating,
 * hashed, revocable refresh tokens. See RESEARCH.md "Don't Hand-Roll" and
 * threats T-01-16/T-01-17/T-01-18/T-01-20.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issueAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync(
      { ...payload },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
        algorithm: 'HS256',
      },
    );
  }

  /** Returns the RAW token; only its SHA-256 hash is ever persisted. */
  async issueRefreshToken(accountId: string): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        accountId,
        tokenHash: this.hash(raw),
        expiresAt: this.refreshExpiryDate(),
      },
    });
    return raw;
  }

  /**
   * Single-use rotation: the presented token is revoked and a new
   * access+refresh pair is issued inside one transaction. The Account is
   * re-read fresh (not trusted from the old token) so a role/approval
   * change takes effect on the very next refresh — see threat T-01-20.
   */
  async rotateRefreshToken(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hash(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt !== null || existing.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: existing.accountId },
      include: { staffProfile: true, customerProfile: true, businessAccount: true },
    });
    if (!account || !account.isActive) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const newRawToken = randomBytes(32).toString('hex');
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: {
          accountId: account.id,
          tokenHash: this.hash(newRawToken),
          expiresAt: this.refreshExpiryDate(),
        },
      });
    });

    const payload = buildJwtPayload(account);
    const accessToken = await this.issueAccessToken(payload);
    return { accessToken, refreshToken: newRawToken };
  }

  async revokeAllForAccount(accountId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private refreshExpiryDate(): Date {
    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    return new Date(Date.now() + parseDurationMs(ttl));
  }
}
