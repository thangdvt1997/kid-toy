import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TokenService } from '../auth/token.service';
import { BusinessAccountsService } from './business-accounts.service';
import type { RegisterBusinessDto } from './dto/register-business.dto';
import type { UpdateApprovalDto } from './dto/update-approval.dto';

/**
 * Builds a P2002 error matching Prisma 7's ACTUAL driver-adapter shape.
 * Prisma 7 (with @prisma/adapter-pg) does NOT populate `meta.target` the
 * way older query-engine-based Prisma versions did — it populates
 * `meta.modelName` (mapped from the physical table name the violated
 * constraint belongs to via PrismaClient#resolveErrorMeta). Verified by
 * reading node_modules/.pnpm/@prisma+adapter-pg@7.10.0's mapDriverError
 * (23505 case) and the generated client's resolveErrorMeta — there is no
 * live DB on this machine to confirm empirically, so the disambiguation
 * strategy in BusinessAccountsService.register is keyed off `modelName`,
 * not `target`.
 */
function makeP2002(modelName: 'Account' | 'BusinessAccount'): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName },
  });
}

describe('BusinessAccountsService', () => {
  let service: BusinessAccountsService;
  let prisma: {
    businessAccount: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    priceTier: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: {
    bucketDocuments: string;
    buildKey: jest.Mock;
    putObject: jest.Mock;
    getPresignedUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let tokenService: { revokeAllForAccount: jest.Mock };
  let config: { get: jest.Mock };

  const registerDto: RegisterBusinessDto = {
    email: 'dealer@test.local',
    password: 'Str0ng-Passw0rd!',
    companyName: 'Cua Hang ABC',
    taxId: '0101010101',
    businessType: 'RETAIL_STORE',
  };
  const file = {
    buffer: Buffer.from('%PDF-1.4\n%%EOF'),
    mimetype: 'application/pdf',
    originalname: 'licence.pdf',
  } as Express.Multer.File;

  beforeEach(async () => {
    prisma = {
      businessAccount: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      priceTier: { findUnique: jest.fn() },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    storage = {
      bucketDocuments: 'kidtoy-documents',
      buildKey: jest.fn().mockReturnValue('business-licences/uuid-1234.pdf'),
      putObject: jest.fn().mockResolvedValue('business-licences/uuid-1234.pdf'),
      getPresignedUrl: jest
        .fn()
        .mockResolvedValue('https://minio.local/kidtoy-documents/x?X-Amz-Signature=abc'),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = { revokeAllForAccount: jest.fn().mockResolvedValue(1) };
    config = { get: jest.fn().mockReturnValue(12) };

    const module = await Test.createTestingModule({
      providers: [
        BusinessAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: TokenService, useValue: tokenService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(BusinessAccountsService);
  });

  // -----------------------------------------------------------------------
  // Task 1: register()
  // -----------------------------------------------------------------------
  describe('register', () => {
    it('uploads the file BEFORE writing any row', async () => {
      prisma.$transaction.mockResolvedValueOnce({ id: 'ba-1', accountId: 'acc-1' });

      await service.register(registerDto, file);

      expect(storage.putObject).toHaveBeenCalledWith(
        storage.bucketDocuments,
        'business-licences/uuid-1234.pdf',
        file.buffer,
        file.mimetype,
      );
      const putOrder = storage.putObject.mock.invocationCallOrder[0];
      const txOrder = prisma.$transaction.mock.invocationCallOrder[0];
      expect(putOrder).toBeLessThan(txOrder);
    });

    it('returns the created accountId with approvalStatus PENDING', async () => {
      prisma.$transaction.mockResolvedValueOnce({ id: 'ba-1', accountId: 'acc-1' });
      const result = await service.register(registerDto, file);
      expect(result).toEqual({ accountId: 'ba-1', approvalStatus: 'PENDING' });
    });

    it('maps a P2002 conflict on Account (email) to ConflictException(EMAIL_TAKEN)', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('Account');
      });
      await expect(service.register(registerDto, file)).rejects.toBeInstanceOf(ConflictException);
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('Account');
      });
      await expect(service.register(registerDto, file)).rejects.toMatchObject({
        message: 'EMAIL_TAKEN',
      });
    });

    it('maps a P2002 conflict on BusinessAccount (taxId) to ConflictException(TAX_ID_TAKEN)', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('BusinessAccount');
      });
      await expect(service.register(registerDto, file)).rejects.toMatchObject({
        message: 'TAX_ID_TAKEN',
      });
    });

    it('best-effort deletes the uploaded object when the transaction fails', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('Account');
      });
      await expect(service.register(registerDto, file)).rejects.toThrow();
      expect(storage.deleteObject).toHaveBeenCalledWith(
        storage.bucketDocuments,
        'business-licences/uuid-1234.pdf',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Task 1: getLicenceUrl() — full authorization matrix (6 combinations)
  // -----------------------------------------------------------------------
  describe('getLicenceUrl authorization matrix', () => {
    const ownerAccountId = 'account-owner';
    const row = {
      id: 'ba-1',
      accountId: ownerAccountId,
      businessLicenseKey: 'business-licences/x.pdf',
    };

    beforeEach(() => {
      prisma.businessAccount.findUnique.mockResolvedValue(row);
    });

    it('ALLOWS the owning business account', async () => {
      const viewer: JwtPayload = { sub: ownerAccountId, type: 'BUSINESS_ACCOUNT' };
      const result = await service.getLicenceUrl('ba-1', viewer);
      expect(result.url).toContain('X-Amz-Signature');
      expect(result.expiresInSeconds).toBe(300);
    });

    it('ALLOWS SUPER_ADMIN', async () => {
      const viewer: JwtPayload = { sub: 'staff-1', type: 'STAFF', role: 'SUPER_ADMIN' };
      await expect(service.getLicenceUrl('ba-1', viewer)).resolves.toBeDefined();
    });

    it('ALLOWS SALES', async () => {
      const viewer: JwtPayload = { sub: 'staff-2', type: 'STAFF', role: 'SALES' };
      await expect(service.getLicenceUrl('ba-1', viewer)).resolves.toBeDefined();
    });

    it('DENIES a different business account (IDOR defence)', async () => {
      const viewer: JwtPayload = { sub: 'someone-else', type: 'BUSINESS_ACCOUNT' };
      await expect(service.getLicenceUrl('ba-1', viewer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('DENIES a retail customer', async () => {
      const viewer: JwtPayload = { sub: 'cust-1', type: 'RETAIL_CUSTOMER' };
      await expect(service.getLicenceUrl('ba-1', viewer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('DENIES a WAREHOUSE staff member', async () => {
      const viewer: JwtPayload = { sub: 'staff-3', type: 'STAFF', role: 'WAREHOUSE' };
      await expect(service.getLicenceUrl('ba-1', viewer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the business account or licence key is absent', async () => {
      prisma.businessAccount.findUnique.mockResolvedValueOnce(null);
      const viewer: JwtPayload = { sub: ownerAccountId, type: 'BUSINESS_ACCOUNT' };
      await expect(service.getLicenceUrl('missing', viewer)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Task 2: updateApproval() — cross-field validation branches
  // -----------------------------------------------------------------------
  describe('updateApproval', () => {
    beforeEach(() => {
      prisma.businessAccount.findUnique.mockResolvedValue({ id: 'ba-1', accountId: 'acc-1' });
      prisma.businessAccount.update.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'ba-1',
          accountId: 'acc-1',
          companyName: 'Cua Hang ABC',
          taxId: '0101010101',
          businessType: 'RETAIL_STORE',
          businessLicenseKey: 'business-licences/x.pdf',
          approvalStatus: data.approvalStatus,
          priceTierId: data.priceTierId ?? null,
          rejectionReason: data.rejectionReason ?? null,
          account: { email: 'dealer@test.local' },
          priceTier: data.priceTierId ? { code: 'DEALER_A' } : null,
        }),
      );
    });

    it('rejects APPROVED without priceTierId (400 PRICE_TIER_REQUIRED)', async () => {
      await expect(
        service.updateApproval('ba-1', { approvalStatus: 'APPROVED' } as UpdateApprovalDto),
      ).rejects.toMatchObject({ message: 'PRICE_TIER_REQUIRED' });
    });

    it('rejects an unknown priceTierId (400 PRICE_TIER_NOT_FOUND)', async () => {
      prisma.priceTier.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateApproval('ba-1', {
          approvalStatus: 'APPROVED',
          priceTierId: 'nope',
        } as UpdateApprovalDto),
      ).rejects.toMatchObject({ message: 'PRICE_TIER_NOT_FOUND' });
    });

    it('rejects a default (isDefault) priceTierId (400 DEFAULT_TIER_NOT_ASSIGNABLE)', async () => {
      prisma.priceTier.findUnique.mockResolvedValueOnce({ id: 'retail', isDefault: true });
      await expect(
        service.updateApproval('ba-1', {
          approvalStatus: 'APPROVED',
          priceTierId: 'retail',
        } as UpdateApprovalDto),
      ).rejects.toMatchObject({ message: 'DEFAULT_TIER_NOT_ASSIGNABLE' });
    });

    it('rejects REJECTED without rejectionReason (400 REJECTION_REASON_REQUIRED)', async () => {
      await expect(
        service.updateApproval('ba-1', { approvalStatus: 'REJECTED' } as UpdateApprovalDto),
      ).rejects.toMatchObject({ message: 'REJECTION_REASON_REQUIRED' });
    });

    it('rejects a transition back to PENDING (400 INVALID_APPROVAL_TRANSITION)', async () => {
      await expect(
        service.updateApproval('ba-1', {
          approvalStatus: 'PENDING',
        } as unknown as UpdateApprovalDto),
      ).rejects.toMatchObject({ message: 'INVALID_APPROVAL_TRANSITION' });
    });

    it('approves onto a valid non-default tier and revokes all sessions for the account', async () => {
      prisma.priceTier.findUnique.mockResolvedValueOnce({
        id: 'dealer-a',
        isDefault: false,
        code: 'DEALER_A',
      });
      const result = await service.updateApproval('ba-1', {
        approvalStatus: 'APPROVED',
        priceTierId: 'dealer-a',
      } as UpdateApprovalDto);
      expect(result.approvalStatus).toBe('APPROVED');
      expect(result.priceTierId).toBe('dealer-a');
      expect(tokenService.revokeAllForAccount).toHaveBeenCalledWith('acc-1');
    });

    it('rejects with a reason and revokes all sessions for the account', async () => {
      const result = await service.updateApproval('ba-1', {
        approvalStatus: 'REJECTED',
        rejectionReason: 'Giay phep khong hop le',
      } as UpdateApprovalDto);
      expect(result.approvalStatus).toBe('REJECTED');
      expect(result.rejectionReason).toBe('Giay phep khong hop le');
      expect(tokenService.revokeAllForAccount).toHaveBeenCalledWith('acc-1');
    });

    it('throws NotFoundException for an unknown business account id', async () => {
      prisma.businessAccount.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateApproval('missing', {
          approvalStatus: 'APPROVED',
          priceTierId: 'x',
        } as UpdateApprovalDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
