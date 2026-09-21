import type { AccountType, StaffRole } from '@kid-toy/shared-types';

/**
 * The shape signed into every access token and set as `request.user` by
 * JwtStrategy. Plans 04-08 are written against this exact interface — see
 * 01-03-PLAN.md <interfaces>.
 */
export interface JwtPayload {
  sub: string; // Account.id
  type: AccountType;
  role?: StaffRole; // present only when type === 'STAFF'
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'; // present only when type === 'BUSINESS_ACCOUNT'
  priceTierId?: string | null; // present only when type === 'BUSINESS_ACCOUNT' and APPROVED
}
