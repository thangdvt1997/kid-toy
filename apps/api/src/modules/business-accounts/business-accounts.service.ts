import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { BusinessAccountSummary } from '@kid-toy/shared-types';
import type { Env } from '../../config/env.schema';
import {
  Prisma,
  type Account,
  type BusinessAccount,
  type PriceTier,
} from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TokenService } from '../auth/token.service';
import type { JwtPayload } from '../../common/types/jwt-payload';
import type { RegisterBusinessDto } from './dto/register-business.dto';
import type { UpdateApprovalDto } from './dto/update-approval.dto';
import type { ListBusinessAccountsQuery } from './dto/list-business-accounts.query';

type BusinessAccountWithRelations = BusinessAccount & {
  account: Account;
  priceTier: PriceTier | null;
};

const LICENCE_URL_TTL_SECONDS = 300;

/**
 * This service is the MINIMAL Phase 1 identity + approval transition that
 * exists solely to make AUTH-03 (B2B registration) and CATALOG-06 (viewer-
 * aware pricing) demonstrable. B2B-02 (proof-document review queue) and
 * B2B-03 (tier-assignment UI) are Phase 4 — do not grow this service into
 * that full workflow here.
 */
@Injectable()
export class BusinessAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // -------------------------------------------------------------------
  // Task 1: registration + authenticated/role-checked licence retrieval
  // -------------------------------------------------------------------

  async register(
    dto: RegisterBusinessDto,
    file: Express.Multer.File,
  ): Promise<{ accountId: string; approvalStatus: 'PENDING' }> {
    const cost = this.config.get('BCRYPT_COST', { infer: true });
    const passwordHash = await bcrypt.hash(dto.password, cost);
    const businessLicenseKey = this.storage.buildKey('business-licences', file.originalname);

    // Upload FIRST — a storage failure aborts before any row is written.
    await this.storage.putObject(
      this.storage.bucketDocuments,
      businessLicenseKey,
      file.buffer,
      file.mimetype,
    );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: { email: dto.email, passwordHash, type: 'BUSINESS_ACCOUNT' },
        });
        // approvalStatus/priceTierId are hardcoded — never accepted from the
        // request body (T-01-26: self-approval / tier self-assignment).
        return tx.businessAccount.create({
          data: {
            accountId: account.id,
            companyName: dto.companyName,
            taxId: dto.taxId,
            businessType: dto.businessType,
            approvalStatus: 'PENDING',
            priceTierId: null,
            businessLicenseKey,
          },
        });
      });
      return { accountId: created.id, approvalStatus: 'PENDING' };
    } catch (err) {
      // Best-effort cleanup — the row never got created, so the uploaded
      // object would otherwise be orphaned in the documents bucket. A
      // cleanup failure must never mask the original error.
      await this.storage
        .deleteObject(this.storage.bucketDocuments, businessLicenseKey)
        .catch(() => undefined);

      throw this.mapRegisterError(err);
    }
  }

  /**
   * Prisma 7 (with @prisma/adapter-pg) does NOT populate `meta.target` for
   * P2002 the way older query-engine-based Prisma versions did. It
   * populates `meta.modelName` — the Prisma model whose table the violated
   * unique constraint belongs to (mapped from the physical table name via
   * PrismaClient#resolveErrorMeta; verified by reading
   * node_modules/@prisma/adapter-pg's 23505 mapping and the generated
   * client's resolveErrorMeta — no live DB on this machine to confirm
   * empirically). Account.email is the only unique column on Account;
   * BusinessAccount.taxId is the only *user-supplied* unique column on
   * BusinessAccount (accountId is server-generated and cannot collide).
   */
  private mapRegisterError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const modelName = typeof err.meta?.modelName === 'string' ? err.meta.modelName : undefined;
      if (modelName === 'Account') {
        return new ConflictException('EMAIL_TAKEN');
      }
      if (modelName === 'BusinessAccount') {
        return new ConflictException('TAX_ID_TAKEN');
      }
      return new ConflictException('DUPLICATE_VALUE');
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async getLicenceUrl(
    businessAccountId: string,
    viewer: JwtPayload,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const row = await this.prisma.businessAccount.findUnique({
      where: { id: businessAccountId },
    });
    if (!row || !row.businessLicenseKey) {
      throw new NotFoundException('Business account or licence not found');
    }

    // Ownership is decided by comparing viewer.sub (from the VERIFIED JWT)
    // against the accountId loaded from the DATABASE row — never from a
    // client-supplied body/query parameter (IDOR defence, T-01-24).
    const isStaffAllowed =
      viewer.type === 'STAFF' && (viewer.role === 'SUPER_ADMIN' || viewer.role === 'SALES');
    const isOwner = viewer.type === 'BUSINESS_ACCOUNT' && viewer.sub === row.accountId;
    if (!isStaffAllowed && !isOwner) {
      throw new ForbiddenException();
    }

    const url = await this.storage.getPresignedUrl(
      this.storage.bucketDocuments,
      row.businessLicenseKey,
      LICENCE_URL_TTL_SECONDS,
    );
    return { url, expiresInSeconds: LICENCE_URL_TTL_SECONDS };
  }

  // -------------------------------------------------------------------
  // Task 2: minimal staff approval transition
  // -------------------------------------------------------------------

  async updateApproval(id: string, dto: UpdateApprovalDto): Promise<BusinessAccountSummary> {
    const row = await this.prisma.businessAccount.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Business account not found');
    }

    // Defensive at the SERVICE level, not only the DTO — this rule must
    // hold for any future caller, not just the HTTP layer.
    if (dto.approvalStatus !== 'APPROVED' && dto.approvalStatus !== 'REJECTED') {
      throw new BadRequestException('INVALID_APPROVAL_TRANSITION');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.approvalStatus === 'APPROVED') {
        if (!dto.priceTierId) {
          throw new BadRequestException('PRICE_TIER_REQUIRED');
        }
        const tier = await tx.priceTier.findUnique({ where: { id: dto.priceTierId } });
        if (!tier) {
          throw new BadRequestException('PRICE_TIER_NOT_FOUND');
        }
        if (tier.isDefault) {
          throw new BadRequestException('DEFAULT_TIER_NOT_ASSIGNABLE');
        }

        return tx.businessAccount.update({
          where: { id },
          data: { approvalStatus: 'APPROVED', priceTierId: dto.priceTierId, rejectionReason: null },
          include: { account: true, priceTier: true },
        });
      }

      // REJECTED
      if (!dto.rejectionReason || dto.rejectionReason.trim().length === 0) {
        throw new BadRequestException('REJECTION_REASON_REQUIRED');
      }
      return tx.businessAccount.update({
        where: { id },
        data: { approvalStatus: 'REJECTED', priceTierId: null, rejectionReason: dto.rejectionReason },
        include: { account: true, priceTier: true },
      });
    });

    // A pricing-tier assignment has direct revenue consequence (T-01-28) —
    // force a fresh login so a token minted before this transition cannot
    // keep using stale approval/tier data.
    await this.tokenService.revokeAllForAccount(updated.accountId);

    return this.toSummary(updated);
  }

  async list(
    query: ListBusinessAccountsQuery,
  ): Promise<{ items: BusinessAccountSummary[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.status ? { approvalStatus: query.status } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.businessAccount.findMany({
        where,
        include: { account: true, priceTier: true },
        // BusinessAccount has no createdAt column in the Plan 02 schema —
        // cuid() ids are chronologically monotonic-ish, so id desc is a
        // reasonable approximation without requiring a schema migration
        // this dev environment (no live DB) cannot verify end to end.
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.businessAccount.count({ where }),
    ]);

    return { items: rows.map((row) => this.toSummary(row)), total };
  }

  /** The raw businessLicenseKey is NEVER returned to any client. */
  private toSummary(row: BusinessAccountWithRelations): BusinessAccountSummary {
    return {
      id: row.id,
      accountId: row.accountId,
      email: row.account.email,
      companyName: row.companyName,
      taxId: row.taxId,
      businessType: row.businessType,
      approvalStatus: row.approvalStatus,
      rejectionReason: row.rejectionReason,
      priceTierId: row.priceTierId,
      priceTierCode: row.priceTier?.code ?? null,
      hasLicence: row.businessLicenseKey !== null,
    };
  }
}
