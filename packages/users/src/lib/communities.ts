import { createId, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import { withTransaction } from "./transaction";
import type {
  Community,
  CommunityMembership,
  EnsureCommunityMembershipInput,
  GetCommunityByProviderInput,
  UpsertCommunityInput,
  UserExecutor,
} from "./types";

export async function upsertCommunity(input: UpsertCommunityInput): Promise<Community> {
  const executor = input.tx ?? input.db;
  const [community] = await executor
    .insert(schema.communities)
    .values({
      displayName: input.displayName,
      id: input.id ?? createId(),
      metadata: input.metadata ?? {},
      provider: input.provider,
      providerCommunityId: input.providerCommunityId,
      slug: input.slug,
    })
    .onConflictDoUpdate({
      set: {
        displayName: input.displayName,
        metadata: input.metadata ?? {},
        slug: input.slug,
        updatedAt: new Date(),
      },
      target: [schema.communities.provider, schema.communities.providerCommunityId],
    })
    .returning();

  if (!community) {
    throw new Error("Failed to upsert community");
  }

  return community;
}

export async function getCommunityByProvider(
  input: GetCommunityByProviderInput,
): Promise<Community | null> {
  const executor = input.tx ?? input.db;
  const [community] = await executor
    .select()
    .from(schema.communities)
    .where(
      and(
        eq(schema.communities.provider, input.provider),
        eq(schema.communities.providerCommunityId, input.providerCommunityId),
      ),
    )
    .limit(1);

  return community ?? null;
}

export async function ensureCommunityMembership(
  input: EnsureCommunityMembershipInput,
): Promise<CommunityMembership> {
  return withTransaction(input, async (tx) => ensureCommunityMembershipWithTx(tx, input));
}

async function ensureCommunityMembershipWithTx(
  tx: UserExecutor,
  input: EnsureCommunityMembershipInput,
): Promise<CommunityMembership> {
  const [membership] = await tx
    .insert(schema.communityMemberships)
    .values({
      communityId: input.communityId,
      displayNameSnapshot: input.displayNameSnapshot ?? null,
      id: input.id ?? createId(),
      metadata: input.metadata ?? {},
      providerMemberId: input.providerMemberId,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        displayNameSnapshot: input.displayNameSnapshot ?? null,
        lastSeenAt: new Date(),
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
      target: [schema.communityMemberships.communityId, schema.communityMemberships.userId],
    })
    .returning();

  if (!membership) {
    throw new Error("Failed to ensure community membership");
  }

  return membership;
}

export async function getCommunityMembership(input: {
  db: GetCommunityByProviderInput["db"];
  communityId: string;
  userId: string;
}): Promise<CommunityMembership | null> {
  const [membership] = await input.db
    .select()
    .from(schema.communityMemberships)
    .where(
      and(
        eq(schema.communityMemberships.communityId, input.communityId),
        eq(schema.communityMemberships.userId, input.userId),
      ),
    )
    .limit(1);

  return membership ?? null;
}
