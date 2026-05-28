import { createId, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import type {
  GrantUserRoleInput,
  HasUserPermissionInput,
  ListUserRolesInput,
  UserPermission,
  UserRole,
  UserRoleName,
} from "./types";

const ROLE_PERMISSIONS = {
  admin: ["account.adjust", "market.manage"],
  market_admin: ["market.manage"],
} as const satisfies Record<UserRoleName, readonly UserPermission[]>;

export async function grantUserRole(input: GrantUserRoleInput): Promise<UserRole> {
  const executor = input.tx ?? input.db;
  const [role] = await executor
    .insert(schema.userRoles)
    .values({
      id: createId(),
      role: input.role,
      scopeId: input.communityId ?? "*",
      scopeType: input.communityId ? "community" : "global",
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        updatedAt: new Date(),
      },
      target: [
        schema.userRoles.userId,
        schema.userRoles.role,
        schema.userRoles.scopeType,
        schema.userRoles.scopeId,
      ],
    })
    .returning();

  if (!role) {
    throw new Error("Failed to grant user role");
  }

  return role;
}

export async function listUserRoles(input: ListUserRolesInput): Promise<UserRole[]> {
  const executor = input.tx ?? input.db;

  return executor
    .select()
    .from(schema.userRoles)
    .where(
      and(
        eq(schema.userRoles.userId, input.userId),
        input.communityId
          ? and(
              eq(schema.userRoles.scopeType, "community"),
              eq(schema.userRoles.scopeId, input.communityId),
            )
          : eq(schema.userRoles.scopeType, "global"),
      ),
    );
}

export async function hasUserPermission(input: HasUserPermissionInput): Promise<boolean> {
  const roles = await listUserRoles(input);
  const globalRoles = input.communityId
    ? await listUserRoles(
        input.tx
          ? {
              db: input.db,
              tx: input.tx,
              userId: input.userId,
            }
          : {
              db: input.db,
              userId: input.userId,
            },
      )
    : [];

  return [...roles, ...globalRoles].some((role) =>
    roleHasPermission(asUserRoleName(role.role), input.permission, role.scopeType),
  );
}

export function roleHasPermission(
  role: UserRoleName | null,
  permission: UserPermission,
  scopeType: UserRole["scopeType"] = "global",
): boolean {
  if (!role) {
    return false;
  }

  if (scopeType === "community" && permission === "account.adjust") {
    return false;
  }

  return ROLE_PERMISSIONS[role].some((candidate) => candidate === permission);
}

function asUserRoleName(value: string): UserRoleName | null {
  return value === "admin" || value === "market_admin" ? value : null;
}
