import type {
  AccountResponse,
  ApiErrorResponse,
  ApiOk,
  AutocompleteMarketsResponse,
  CreateMarketResponse,
  LeaderboardResponse,
  Serialized,
} from "@habit-gamba/api";
import { createDbClient, createId, repToMicro } from "@habit-gamba/db";
import { grantUserRole } from "@habit-gamba/users";
import { getBalance } from "@habit-gamba/wallet";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
const guildA = {
  displayName: "Community Scope Guild A",
  provider: "discord",
  providerCommunityId: `guild-a-${createId().toLowerCase()}`,
};
const guildB = {
  displayName: "Community Scope Guild B",
  provider: "discord",
  providerCommunityId: `guild-b-${createId().toLowerCase()}`,
};

maybeDescribe("community scopes", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 8 });
  const app = createApp({
    botApiToken: "community-scope-test-token",
    db: client.db,
  });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("gives the same Discord user isolated starter balances per guild", async () => {
    const providerUserId = `discord-shared-${createId()}`;
    const first = await registerAccount({
      displayName: "Shared Discord User",
      providerCommunityId: guildA.providerCommunityId,
      providerUserId,
    });
    const second = await registerAccount({
      displayName: "Shared Discord User",
      providerCommunityId: guildB.providerCommunityId,
      providerUserId,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.user.id).toBe(second.body.user.id);
    expect(first.body.balance.availableAmountMicro).toBe(repToMicro(1_000n).toString());
    expect(second.body.balance.availableAmountMicro).toBe(repToMicro(1_000n).toString());

    const accountA = await readAccount(providerUserId, guildA);
    const accountB = await readAccount(providerUserId, guildB);

    expect(accountA.balance.availableAmountMicro).toBe(repToMicro(1_000n).toString());
    expect(accountB.balance.availableAmountMicro).toBe(repToMicro(1_000n).toString());
  });

  it("does not change another community balance or leaderboard when trading", async () => {
    const providerUserId = `discord-trader-${createId()}`;
    await registerAccount({
      displayName: "Trader",
      providerCommunityId: guildA.providerCommunityId,
      providerUserId,
    });
    await registerAccount({
      displayName: "Trader",
      providerCommunityId: guildB.providerCommunityId,
      providerUserId,
    });

    const traderA = await readAccount(providerUserId, guildA);
    const creatorA = await registerAndReadAccount(`creator-a-${createId()}`, guildA);
    const marketA = await createMarket(creatorA.providerUserId, guildA, {
      slug: `scope-trade-${createId().toLowerCase()}`,
      title: "Will guild A trade stay isolated?",
    });

    await openMarket(creatorA.providerUserId, guildA, marketA.id);
    const buyResponse = await requestJson(`/markets/${marketA.id}/buy`, {
      body: {
        amountMicro: repToMicro(25n).toString(),
        outcome: "YES",
      },
      community: guildA,
      headers: authHeaders("discord", providerUserId, guildA),
      idempotencyKey: `scope-test:${traderA.user.id}:buy`,
      method: "POST",
    });

    expect(buyResponse.status).toBe(201);

    const accountAfterA = await readAccount(providerUserId, guildA);
    const accountAfterB = await readAccount(providerUserId, guildB);
    const balanceA = await getBalance({
      communityId: accountAfterA.balance.communityId ?? "",
      db: client.db,
      userId: traderA.user.id,
    });
    const balanceB = await getBalance({
      communityId: accountAfterB.balance.communityId ?? "",
      db: client.db,
      userId: traderA.user.id,
    });
    const leaderboardA = await readLeaderboard(guildA);
    const leaderboardB = await readLeaderboard(guildB);

    expect(balanceA.availableAmountMicro).toBe(repToMicro(975n));
    expect(balanceB.availableAmountMicro).toBe(repToMicro(1_000n));
    expect(
      leaderboardA.entries.find((entry) => entry.user.id === traderA.user.id)?.balance
        .availableAmountMicro,
    ).toBe(repToMicro(975n).toString());
    expect(
      leaderboardB.entries.find((entry) => entry.user.id === traderA.user.id)?.balance
        .availableAmountMicro,
    ).toBe(repToMicro(1_000n).toString());
  });

  it("does not leak autocomplete markets across communities", async () => {
    const uniqueTitle = `Scope Leak ${createId()}`;
    const creator = await registerAndReadAccount(`creator-leak-${createId()}`, guildA);
    await createMarket(creator.providerUserId, guildA, {
      slug: `scope-leak-${createId().toLowerCase()}`,
      title: uniqueTitle,
    });

    const response = await app.request(`/markets?query=${encodeURIComponent(uniqueTitle)}`, {
      headers: communityHeaders(guildB),
    });
    const body = await jsonOk<AutocompleteMarketsResponse>(response);

    expect(response.status).toBe(200);
    expect(body.markets).toHaveLength(0);
  });

  it("allows the same market slug in different communities", async () => {
    const slug = `shared-slug-${createId().toLowerCase()}`;
    const creatorA = await registerAndReadAccount(`creator-slug-a-${createId()}`, guildA);
    const creatorB = await registerAndReadAccount(`creator-slug-b-${createId()}`, guildB);
    const marketA = await createMarket(creatorA.providerUserId, guildA, {
      slug,
      title: "Shared slug market A",
    });
    const marketB = await createMarket(creatorB.providerUserId, guildB, {
      slug,
      title: "Shared slug market B",
    });

    expect(marketA.slug).toBe(slug);
    expect(marketB.slug).toBe(slug);
    expect(marketA.id).not.toBe(marketB.id);
  });

  it("limits scoped market admins to their community", async () => {
    const creatorA = await registerAndReadAccount(`scoped-owner-a-${createId()}`, guildA);
    const creatorB = await registerAndReadAccount(`scoped-owner-b-${createId()}`, guildB);
    const scopedAdminProviderUserId = `scoped-admin-${createId()}`;

    await registerAccount({
      displayName: "Scoped Admin",
      providerCommunityId: guildA.providerCommunityId,
      providerUserId: scopedAdminProviderUserId,
    });
    const scopedAdminA = await readAccount(scopedAdminProviderUserId, guildA);

    await registerAccount({
      displayName: scopedAdminA.user.displayName,
      providerCommunityId: guildB.providerCommunityId,
      providerUserId: scopedAdminProviderUserId,
    });

    const marketA = await createMarket(creatorA.providerUserId, guildA, {
      slug: `scope-admin-a-${createId().toLowerCase()}`,
      title: "Scoped admin market A",
    });
    const marketB = await createMarket(creatorB.providerUserId, guildB, {
      slug: `scope-admin-b-${createId().toLowerCase()}`,
      title: "Scoped admin market B",
    });

    if (!scopedAdminA.balance.communityId) {
      throw new Error("Expected scoped admin balance to include communityId");
    }

    await grantUserRole({
      communityId: scopedAdminA.balance.communityId,
      db: client.db,
      role: "market_admin",
      userId: scopedAdminA.user.id,
    });
    await openMarket(creatorA.providerUserId, guildA, marketA.id);
    await openMarket(creatorB.providerUserId, guildB, marketB.id);

    const allowed = await requestJson(`/markets/${marketA.id}/close`, {
      body: {},
      community: guildA,
      headers: authHeaders("discord", scopedAdminProviderUserId, guildA),
      method: "POST",
    });
    const denied = await requestJson(`/markets/${marketB.id}/close`, {
      body: {},
      community: guildB,
      headers: authHeaders("discord", scopedAdminProviderUserId, guildB),
      method: "POST",
    });

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  async function registerAccount(input: {
    displayName: string;
    providerCommunityId: string;
    providerUserId: string;
  }) {
    const response = await requestJson("/accounts/register", {
      body: {
        communityDisplayName: input.providerCommunityId,
        communityProvider: "discord",
        displayName: input.displayName,
        provider: "discord",
        providerCommunityId: input.providerCommunityId,
        providerUserId: input.providerUserId,
      },
      headers: botHeaders(),
      method: "POST",
    });

    return {
      body: await jsonOk<AccountResponse>(response),
      status: response.status,
    };
  }

  async function registerAndReadAccount(label: string, community: typeof guildA) {
    const providerUserId = `${label}-${createId()}`;

    await registerAccount({
      displayName: `Scope Test ${label}`,
      providerCommunityId: community.providerCommunityId,
      providerUserId,
    });

    return {
      providerUserId,
      ...(await readAccount(providerUserId, community)),
    };
  }

  async function readAccount(providerUserId: string, community: typeof guildA) {
    const response = await app.request("/accounts/me", {
      headers: authHeaders("discord", providerUserId, community),
    });

    return jsonOk<AccountResponse>(response);
  }

  async function createMarket(
    providerUserId: string,
    community: typeof guildA,
    body: { slug: string; title: string },
  ) {
    const response = await requestJson("/markets", {
      body,
      community,
      headers: authHeaders("discord", providerUserId, community),
      method: "POST",
    });
    const marketBody = await jsonOk<CreateMarketResponse>(response);

    expect(response.status).toBe(201);

    return marketBody.market;
  }

  async function openMarket(providerUserId: string, community: typeof guildA, marketId: string) {
    const response = await requestJson(`/markets/${marketId}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      community,
      headers: authHeaders("discord", providerUserId, community),
      method: "POST",
    });

    expect(response.status).toBe(200);
  }

  async function readLeaderboard(community: typeof guildA) {
    const response = await app.request("/leaderboard?limit=50", {
      headers: communityHeaders(community),
    });

    return jsonOk<LeaderboardResponse>(response);
  }

  function requestJson(
    path: string,
    input: {
      body: unknown;
      community?: typeof guildA;
      headers?: Record<string, string>;
      idempotencyKey?: string;
      method: "POST";
    },
  ) {
    return app.request(path, {
      body: JSON.stringify(input.body),
      headers: {
        "Content-Type": "application/json",
        ...communityHeaders(input.community ?? guildA),
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
        ...input.headers,
      },
      method: input.method,
    });
  }
});

function authHeaders(
  provider: string,
  providerUserId: string,
  community: typeof guildA = {
    displayName: "Habit Gamba",
    provider: "system",
    providerCommunityId: "default",
  },
) {
  return {
    ...communityHeaders(community),
    "X-Provider": provider,
    "X-Provider-User-Id": providerUserId,
  };
}

function communityHeaders(community: typeof guildA) {
  return {
    "X-Community-Provider": community.provider,
    "X-Provider-Community-Id": community.providerCommunityId,
  };
}

function botHeaders() {
  return {
    Authorization: "Bearer community-scope-test-token",
  };
}

async function jsonOk<T>(response: Response): Promise<Serialized<T>> {
  const body = (await response.json()) as ApiOk<T> | ApiErrorResponse;

  if ("error" in body && body.error) {
    throw new Error(body.error.message);
  }

  return (body as ApiOk<T>).data;
}
