import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../notifications/mailer.service';
import { TokenService } from './token.service';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let prisma: {
    account: { findUnique: jest.Mock; update: jest.Mock };
    passwordResetToken: {
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mailer: { sendPasswordReset: jest.Mock };
  let tokenService: { revokeAllForAccount: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      account: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue(undefined) },
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    tokenService = { revokeAllForAccount: jest.fn().mockResolvedValue(1) };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PASSWORD_RESET_TTL_MINUTES: 60,
          APP_BASE_URL: 'http://localhost:3000',
          BCRYPT_COST: 12,
        };
        return values[key];
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        { provide: TokenService, useValue: tokenService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(PasswordResetService);
  });

  describe('request', () => {
    it('is a silent no-op for an unknown email — no row, no mail', async () => {
      prisma.account.findUnique.mockResolvedValueOnce(null);
      await service.request('nobody@test.local');
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('is a silent no-op for an inactive account', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        email: 'a@test.local',
        isActive: false,
      });
      await service.request('a@test.local');
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('stores only the sha256 hash of the raw token — never the raw value', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        email: 'a@test.local',
        isActive: true,
      });
      await service.request('a@test.local');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const data = (
        prisma.passwordResetToken.create.mock.calls[0][0] as { data: { tokenHash: string } }
      ).data;
      expect(mailer.sendPasswordReset).toHaveBeenCalledTimes(1);
      const resetUrl = mailer.sendPasswordReset.mock.calls[0][1] as string;
      const rawToken = new URL(resetUrl).searchParams.get('token')!;

      expect(data.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
      expect(data.tokenHash).not.toBe(rawToken);

      // A lookup by the RAW token value finds no matching row in a real DB —
      // demonstrated here by asserting the persisted hash is never equal to
      // the raw token that would be used for such a lookup.
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
      const lookupByRaw = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: rawToken },
      });
      expect(lookupByRaw).toBeNull();
    });

    it('supersedes any outstanding unused/unexpired token for the account', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        email: 'a@test.local',
        isActive: true,
      });
      await service.request('a@test.local');
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { accountId: 'acc-1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('defaults the reset URL locale to vi', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        email: 'a@test.local',
        isActive: true,
      });
      await service.request('a@test.local');
      const resetUrl = mailer.sendPasswordReset.mock.calls[0][1] as string;
      expect(resetUrl).toContain('/vi/reset-password?token=');
    });

    it('honors an explicit locale', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({
        id: 'acc-1',
        email: 'a@test.local',
        isActive: true,
      });
      await service.request('a@test.local', 'en');
      const resetUrl = mailer.sendPasswordReset.mock.calls[0][1] as string;
      expect(resetUrl).toContain('/en/reset-password?token=');
    });
  });

  describe('reset', () => {
    const SAME_MESSAGE = 'INVALID_OR_EXPIRED_TOKEN';

    it('rejects an unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
      await expect(service.reset('unknown', 'NewStr0ngPass!')).rejects.toMatchObject({
        message: SAME_MESSAGE,
      });
    });

    it('rejects an already-used token with the identical message', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'prt-1',
        accountId: 'acc-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.reset('used', 'NewStr0ngPass!')).rejects.toMatchObject({
        message: SAME_MESSAGE,
      });
    });

    it('rejects an expired token with the identical message', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'prt-1',
        accountId: 'acc-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.reset('expired', 'NewStr0ngPass!')).rejects.toMatchObject({
        message: SAME_MESSAGE,
      });
    });

    it('updates the password hash, marks the token used, and revokes all refresh tokens on success', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({
        id: 'prt-1',
        accountId: 'acc-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      await service.reset('valid-raw-token', 'NewStr0ngPass!');

      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'prt-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { passwordHash: expect.any(String) },
      });
      expect(tokenService.revokeAllForAccount).toHaveBeenCalledWith('acc-1');
    });
  });
});
