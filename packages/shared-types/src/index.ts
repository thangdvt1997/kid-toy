export type Locale = "vi" | "en";

export type AccountType = "STAFF" | "RETAIL_CUSTOMER" | "BUSINESS_ACCOUNT";
export type StaffRole = "SUPER_ADMIN" | "SALES" | "WAREHOUSE" | "CONTENT";
export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface AuthenticatedAccount {
  id: string;
  email: string;
  type: AccountType;
  role?: StaffRole;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  priceTierId?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export {};
