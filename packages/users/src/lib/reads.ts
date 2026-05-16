import { schema } from "@habit-gamba/db";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import type { ListUsersInput, ListUsersResult, User, UserDbInput } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function getUserById(input: UserDbInput & { userId: string }): Promise<User | null> {
  const executor = input.tx ?? input.db;
  const [user] = await executor
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.userId))
    .limit(1);

  return user ?? null;
}

export async function getUserByProviderIdentity(
  input: UserDbInput & {
    provider: string;
    providerUserId: string;
  },
): Promise<User | null> {
  const executor = input.tx ?? input.db;
  const [user] = await executor
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.provider, input.provider),
        eq(schema.users.providerUserId, input.providerUserId),
      ),
    )
    .limit(1);

  return user ?? null;
}

export async function listUsers(input: ListUsersInput): Promise<ListUsersResult> {
  const executor = input.tx ?? input.db;
  const limit = normalizeLimit(input.limit);
  const where = and(
    input.statuses && input.statuses.length > 0
      ? inArray(schema.users.status, input.statuses)
      : undefined,
    input.cursor
      ? or(
          lt(schema.users.createdAt, input.cursor.createdAt),
          and(
            eq(schema.users.createdAt, input.cursor.createdAt),
            lt(schema.users.id, input.cursor.id),
          ),
        )
      : undefined,
  );

  const rows = await executor
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.createdAt), desc(schema.users.id))
    .limit(limit + 1);

  const users = rows.slice(0, limit);
  const lastUser = users.at(-1);
  const hasNextPage = rows.length > limit;

  return {
    nextCursor:
      hasNextPage && lastUser
        ? {
            createdAt: lastUser.createdAt,
            id: lastUser.id,
          }
        : null,
    users,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }

  return Math.min(limit, MAX_LIMIT);
}
