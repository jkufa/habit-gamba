import { createId, schema } from "@habit-gamba/db";
import { eq } from "drizzle-orm";

import type {
  GrantUserRoleInput,
  HasUserPermissionInput,
  ListUserRolesInput,
  UserPermission,
  UserRole,
  UserRoleName,
} from "./types";

const ROLE_PERMISSIONS = {
  market_admin: ["market.manage"],
} as const satisfies Record<UserRoleName, readonly UserPermission[]>;

export async function grantUserRole(input: GrantUserRoleInput): Promise<UserRole> {
  const executor = input.tx ?? input.db;
  const [role] = await executor
    .insert(schema.userRoles)
    .values({
      id: createId(),
      role: input.role,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        updatedAt: new Date(),
      },
      target: [schema.userRoles.userId, schema.userRoles.role],
    })
    .returning();

  if (!role) {
    throw new Error("Failed to grant user role");
  }

  return role;
}

export async function listUserRoles(input: ListUserRolesInput): Promise<UserRole[]> {
  const executor = input.tx ?? input.db;

  return executor.select().from(schema.userRoles).where(eq(schema.userRoles.userId, input.userId));
}

export async function hasUserPermission(input: HasUserPermissionInput): Promise<boolean> {
  const roles = await listUserRoles(input);

  return roles.some((role) => roleHasPermission(asUserRoleName(role.role), input.permission));
}

export function roleHasPermission(role: UserRoleName | null, permission: UserPermission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

function asUserRoleName(value: string): UserRoleName | null {
  return value === "market_admin" ? value : null;
}
