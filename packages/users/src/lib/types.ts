import type { DbClient, schema } from "@habit-gamba/db";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type UserExecutor = DbClient | DbTransaction;
export type User = typeof schema.users.$inferSelect;
export type UserRole = typeof schema.userRoles.$inferSelect;
export type UserRoleName = "admin" | "market_admin";
export type UserPermission = "account.adjust" | "market.manage";
export type Balance = typeof schema.balances.$inferSelect;
export type LedgerEntry = typeof schema.ledgerEntries.$inferSelect;
export type UserStatus = User["status"];

export type UserDbInput = {
  db: DbClient;
  tx?: DbTransaction;
};

export type CreateUserInput = UserDbInput & {
  id?: string;
  provider: string;
  providerUserId: string;
  handle?: string | null;
  displayName: string;
  metadata?: Record<string, unknown>;
};

export type UpsertUserInput = CreateUserInput;

export type UpdateUserProfileInput = UserDbInput & {
  userId: string;
  handle?: string | null;
  displayName?: string;
  metadata?: Record<string, unknown>;
};

export type UserListCursor = {
  createdAt: Date;
  id: string;
};

export type ListUsersInput = UserDbInput & {
  cursor?: UserListCursor;
  limit?: number;
  statuses?: UserStatus[];
};

export type ListUsersResult = {
  users: User[];
  nextCursor: UserListCursor | null;
};

export type GrantUserRoleInput = UserDbInput & {
  role: UserRoleName;
  userId: string;
};

export type ListUserRolesInput = UserDbInput & {
  userId: string;
};

export type HasUserPermissionInput = UserDbInput & {
  permission: UserPermission;
  userId: string;
};

export type EnsureSeedRepGrantInput = UserDbInput & {
  userId: string;
  amountMicro: bigint;
  idempotencyKey: string;
  balanceId?: string;
  ledgerEntryId?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
};

export type EnsureSeedRepGrantResult = {
  balance: Balance;
  ledgerEntry: LedgerEntry;
  idempotent: boolean;
};
