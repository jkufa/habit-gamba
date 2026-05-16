import { createId, schema } from "@habit-gamba/db";
import { eq } from "drizzle-orm";

import { UserNotFoundError } from "./errors";
import { withTransaction } from "./transaction";
import type {
  CreateUserInput,
  UpdateUserProfileInput,
  UpsertUserInput,
  User,
  UserDbInput,
} from "./types";

export async function createUser(input: CreateUserInput): Promise<User> {
  return withTransaction(input, async (tx) => {
    const [user] = await tx.insert(schema.users).values(toUserInsert(input)).returning();

    if (!user) {
      throw new Error("Failed to create user");
    }

    return user;
  });
}

export async function upsertUser(input: UpsertUserInput): Promise<User> {
  return withTransaction(input, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values(toUserInsert(input))
      .onConflictDoUpdate({
        set: {
          displayName: input.displayName,
          handle: input.handle ?? null,
          metadata: input.metadata ?? {},
          status: "active",
          updatedAt: new Date(),
        },
        target: [schema.users.provider, schema.users.providerUserId],
      })
      .returning();

    if (!user) {
      throw new Error("Failed to upsert user");
    }

    return user;
  });
}

export async function updateUserProfile(input: UpdateUserProfileInput): Promise<User> {
  const set: Partial<typeof schema.users.$inferInsert> = {
    updatedAt: new Date(),
  };

  if ("displayName" in input) {
    set.displayName = input.displayName;
  }

  if ("handle" in input) {
    set.handle = input.handle;
  }

  if ("metadata" in input) {
    set.metadata = input.metadata;
  }

  return withTransaction(input, async (tx) => {
    const [user] = await tx
      .update(schema.users)
      .set(set)
      .where(eq(schema.users.id, input.userId))
      .returning();

    if (!user) {
      throw new UserNotFoundError({ userId: input.userId });
    }

    return user;
  });
}

export async function deactivateUser(input: UserDbInput & { userId: string }): Promise<User> {
  return withTransaction(input, async (tx) => {
    const [user] = await tx
      .update(schema.users)
      .set({
        status: "deactivated",
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, input.userId))
      .returning();

    if (!user) {
      throw new UserNotFoundError({ userId: input.userId });
    }

    return user;
  });
}

function toUserInsert(input: CreateUserInput): typeof schema.users.$inferInsert {
  return {
    displayName: input.displayName,
    handle: input.handle ?? null,
    id: input.id ?? createId(),
    metadata: input.metadata ?? {},
    provider: input.provider,
    providerUserId: input.providerUserId,
    status: "active",
  };
}
