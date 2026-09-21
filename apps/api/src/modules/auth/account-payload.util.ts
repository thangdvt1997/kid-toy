import type {
  Account,
  BusinessAccount,
  CustomerProfile,
  StaffProfile,
} from '../../../prisma/generated/prisma/client';
import type { JwtPayload } from '../../common/types/jwt-payload';

export type AccountWithRelations = Account & {
  staffProfile?: StaffProfile | null;
  customerProfile?: CustomerProfile | null;
  businessAccount?: BusinessAccount | null;
};

/**
 * Single source of truth for turning an Account (+ its 1:1 extension
 * profile) into a JwtPayload. Shared by AuthService.buildPayload (used at
 * login/register) and TokenService.rotateRefreshToken (re-reads the
 * Account fresh on every refresh, so a role/approval change takes effect
 * without waiting for the access token to expire — see threat T-01-20).
 */
export function buildJwtPayload(account: AccountWithRelations): JwtPayload {
  const payload: JwtPayload = {
    sub: account.id,
    type: account.type,
  };

  if (account.type === 'STAFF' && account.staffProfile) {
    payload.role = account.staffProfile.role;
  }

  if (account.type === 'BUSINESS_ACCOUNT' && account.businessAccount) {
    payload.approvalStatus = account.businessAccount.approvalStatus;
    if (account.businessAccount.approvalStatus === 'APPROVED') {
      payload.priceTierId = account.businessAccount.priceTierId ?? null;
    }
  }

  return payload;
}
