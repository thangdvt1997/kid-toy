import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { AuthenticatedAccount, AuthTokens } from '@kid-toy/shared-types';
import type { Env } from '../../config/env.schema';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { buildJwtPayload, type AccountWithRelations } from './account-payload.util';
import type { RegisterCustomerDto } from './dto/register-customer.dto';
import { TokenService } from './token.service';

// Constant-time-ish dummy hash: bcrypt.compare against this runs the same
// cost whether the account is missing, inactive, or the password was just
// wrong — prevents user enumeration via response timing (threat T-01-15).
const DUMMY_HASH = '$2b$12$LgUJNkIxFO9p4SR5bI.5FeqbN5Ah/ICX8lWoCbRrVokCJk/We5KAW';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Returns the account on success, or null for BOTH an unknown email and a
   * wrong password — the caller must map both to an identical response.
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AccountWithRelations | null> {
    const account = await this.prisma.account.findUnique({
      where: { email },
      include: { staffProfile: true, customerProfile: true, businessAccount: true },
    });

    if (!account || !account.isActive) {
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }

    const matches = await bcrypt.compare(password, account.passwordHash);
    return matches ? account : null;
  }

  buildPayload(account: AccountWithRelations): JwtPayload {
    return buildJwtPayload(account);
  }

  async registerCustomer(dto: RegisterCustomerDto): Promise<AccountWithRelations> {
    const cost = this.config.get('BCRYPT_COST', { infer: true });
    const passwordHash = await bcrypt.hash(dto.password, cost);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.account.create({
          data: {
            email: dto.email,
            passwordHash,
            type: 'RETAIL_CUSTOMER',
          },
        });
        await tx.customerProfile.create({
          data: {
            accountId: created.id,
            fullName: dto.fullName,
            phone: dto.phone,
          },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw err;
    }
  }

  async login(
    account: AccountWithRelations,
  ): Promise<AuthTokens & { account: AuthenticatedAccount }> {
    const payload = this.buildPayload(account);
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.issueAccessToken(payload),
      this.tokenService.issueRefreshToken(account.id),
    ]);
    return {
      accessToken,
      refreshToken,
      account: this.toSafeAccount(account, payload),
    };
  }

  /** Explicit safe projection — passwordHash must never leave this class. */
  toSafeAccount(
    account: { id: string; email: string },
    payload: JwtPayload,
  ): AuthenticatedAccount {
    return {
      id: account.id,
      email: account.email,
      type: payload.type,
      role: payload.role,
      approvalStatus: payload.approvalStatus,
      priceTierId: payload.priceTierId,
    };
  }
}
