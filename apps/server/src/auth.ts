import { getUserByProviderIdentity } from "@habit-gamba/users";
import type { User } from "@habit-gamba/users";
import type { DbClient } from "@habit-gamba/db";
import type { Context } from "hono";

import { ApiError } from "./http";

export type AuthenticatedUser = User;

export async function requireUser(context: Context, db: DbClient): Promise<AuthenticatedUser> {
  const provider = context.req.header("X-Provider")?.trim();
  const providerUserId = context.req.header("X-Provider-User-Id")?.trim();

  if (!provider || !providerUserId) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing provider identity headers");
  }

  const user = await getUserByProviderIdentity({
    db,
    provider,
    providerUserId,
  });

  if (!user || user.status !== "active") {
    throw new ApiError(401, "UNAUTHORIZED", "Authenticated user was not found");
  }

  return user;
}
