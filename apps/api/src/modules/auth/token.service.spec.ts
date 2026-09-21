import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: { signAsync: jest.Mock };
  let configService: { get: jest.Mock };
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    account: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'a'.repeat(32),
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL: '30d',
        };
        return values[key];
      }),
    };
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      account: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  it('issueRefreshToken stores only the sha256 hash — a lookup by the raw value finds nothing', async () => {
    const raw = await service.issueRefreshToken('account-1');

    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    const storedHash = (prisma.refreshToken.create.mock.calls[0][0] as { data: { tokenHash: string } })
      .data.tokenHash;
    expect(storedHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(storedHash).not.toBe(raw);

    prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
    const lookupByRaw = await prisma.refreshToken.findUnique({ where: { tokenHash: raw } });
    expect(lookupByRaw).toBeNull();
  });

  it('rotateRefreshToken returns new tokens and revokes the presented one', async () => {
    const raw = 'a'.repeat(64);
    const hash = createHash('sha256').update(raw).digest('hex');
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      accountId: 'account-1',
      tokenHash: hash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    prisma.account.findUnique.mockResolvedValueOnce({
      id: 'account-1',
      type: 'RETAIL_CUSTOMER',
      isActive: true,
    });

    const result = await service.rotateRefreshToken(raw);

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken).not.toBe(raw);
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rotateRefreshToken throws UnauthorizedException for an unknown token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
    await expect(service.rotateRefreshToken('unknown-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotateRefreshToken throws UnauthorizedException for an already-revoked token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      accountId: 'account-1',
      tokenHash: 'x',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    await expect(service.rotateRefreshToken('revoked-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotateRefreshToken throws UnauthorizedException for an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      accountId: 'account-1',
      tokenHash: 'x',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.rotateRefreshToken('expired-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokeAllForAccount revokes every outstanding token for that account and returns the count', async () => {
    prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 3 });
    const count = await service.revokeAllForAccount('account-1');
    expect(count).toBe(3);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'account-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
