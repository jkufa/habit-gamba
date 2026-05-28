import {
  getCommunityByProvider,
  getCommunityMembership,
  getUserByProviderIdentity,
} from "@habit-gamba/users";
import type { Community, User } from "@habit-gamba/users";
import type { DbClient } from "@habit-gamba/db";
import type { Context } from "hono";

import { ApiError } from "./http";

export type AuthenticatedUser = User;
export type RequestCommunity = Community;
export type ProviderIdentity = {
  displayName: string;
  handle?: string | null;
  provider: string;
  providerUserId: string;
};
export type CommunityIdentity = {
  provider: string;
  providerCommunityId: string;
};

export async function requireUser(context: Context, db: DbClient): Promise<AuthenticatedUser> {
  const { provider, providerUserId } = requireProviderHeaders(context);
  return requireUserByProviderIdentity({ db, provider, providerUserId });
}

export function requireProviderHeaders(
  context: Context,
): Pick<ProviderIdentity, "provider" | "providerUserId"> {
  const provider = context.req.header("X-Provider")?.trim();
  const providerUserId = context.req.header("X-Provider-User-Id")?.trim();

  if (!provider || !providerUserId) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing provider identity headers");
  }

  return { provider, providerUserId };
}

export function requireCommunityHeaders(context: Context): CommunityIdentity {
  const provider = context.req.header("X-Community-Provider")?.trim();
  const providerCommunityId = context.req.header("X-Provider-Community-Id")?.trim();

  if (!provider || !providerCommunityId) {
    throw new ApiError(400, "COMMUNITY_REQUIRED", "Missing community identity headers");
  }

  return { provider, providerCommunityId };
}

export async function requireCommunity(context: Context, db: DbClient): Promise<RequestCommunity> {
  const identity = requireCommunityHeaders(context);
  const community = await getCommunityByProvider({
    db,
    provider: identity.provider,
    providerCommunityId: identity.providerCommunityId,
  });

  if (!community) {
    throw new ApiError(404, "COMMUNITY_NOT_FOUND", "Community was not found", identity);
  }

  return community;
}

export async function requireUserWithCommunity(
  context: Context,
  db: DbClient,
): Promise<{ community: RequestCommunity; user: AuthenticatedUser }> {
  const [community, user] = await Promise.all([
    requireCommunity(context, db),
    requireUser(context, db),
  ]);
  const membership = await getCommunityMembership({
    db,
    communityId: community.id,
    userId: user.id,
  });

  if (!membership) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Authenticated user is not registered in this community",
    );
  }

  return { community, user };
}

export async function requireUserByProviderIdentity(input: {
  db: DbClient;
  provider: string;
  providerUserId: string;
}): Promise<AuthenticatedUser> {
  const user = await getUserByProviderIdentity({
    db: input.db,
    provider: input.provider,
    providerUserId: input.providerUserId,
  });

  if (!user || user.status !== "active") {
    throw new ApiError(401, "UNAUTHORIZED", "Authenticated user was not found");
  }

  return user;
}

export function requireInternalBot(context: Context, botApiToken: string | undefined): void {
  if (!botApiToken) {
    throw new ApiError(500, "BOT_API_TOKEN_NOT_CONFIGURED", "Bot API token is not configured");
  }

  const authorization = context.req.header("Authorization")?.trim();
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!token || token !== botApiToken) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid bot API token");
  }
}
