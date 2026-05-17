import { createDbClient, createId, repToMicro, schema } from "@habit-gamba/db";
import { creditRep } from "@habit-gamba/wallet";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;

maybeDescribe("server API", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 8 });
  const app = createApp({
    db: client.db,
    pingDb: async () => {
      await client.sql`select 1`;
    },
  });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("wraps health responses", async () => {
    const response = await app.request("/health");
    const body = await json<ApiResponse>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        ok: true,
        service: "server",
      },
    });
  });

  it("validates writes and requires an existing active header identity", async () => {
    const missingAuth = await requestJson("/markets", {
      body: {
        slug: `api-auth-${createId().toLowerCase()}`,
        title: "Will auth fail?",
      },
      method: "POST",
    });
    const unknownUser = await requestJson("/markets", {
      body: {
        slug: `api-auth-${createId().toLowerCase()}`,
        title: "Will user mapping fail?",
      },
      headers: authHeaders("api-test", "missing"),
      method: "POST",
    });

    expect(missingAuth.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect((await json<ApiResponse>(missingAuth)).error?.code).toBe("UNAUTHORIZED");
  });

  it("creates draft markets, opens them by creator, reads without auth, and serializes bigints", async () => {
    const creator = await insertUser("creator");
    const market = await createMarket(creator.provider, creator.providerUserId);
    const readDraft = await app.request(`/markets/${market.id}`);
    const openedResponse = await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    const openedBody = await json<ApiResponse>(openedResponse);

    expect(readDraft.status).toBe(200);
    expect(market.status).toBe("draft");
    expect(openedResponse.status).toBe(200);
    expect(openedBody.data.status).toBe("open");
    expect(typeof openedBody.data.liquidityParameterMicro).toBe("string");
    expect(openedBody.data.contracts).toHaveLength(2);
  });

  it("rejects non-creator open and resolve attempts", async () => {
    const creator = await insertUser("owner");
    const other = await insertUser("other");
    const market = await createMarket(creator.provider, creator.providerUserId);
    const openResponse = await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(other.provider, other.providerUserId),
      method: "POST",
    });
    const resolveResponse = await requestJson(`/markets/${market.id}/resolve`, {
      body: {
        outcome: "YES",
      },
      headers: authHeaders(other.provider, other.providerUserId),
      method: "POST",
    });

    expect(openResponse.status).toBe(403);
    expect(resolveResponse.status).toBe(403);
  });

  it("validates quote and buy requests, requires idempotency for buys, and returns buy result", async () => {
    const creator = await insertUser("buyer");
    const market = await createMarket(creator.provider, creator.providerUserId);

    await creditRep({
      amountMicro: repToMicro(100n),
      db: client.db,
      idempotencyKey: `server-test:${creator.id}:fund`,
      sourceId: `server-test:${creator.id}:fund`,
      sourceType: "server_test_fund",
      userId: creator.id,
    });
    await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });

    const badQuote = await requestJson(`/markets/${market.id}/quote`, {
      body: {
        amountMicro: "0",
        outcome: "YES",
      },
      method: "POST",
    });
    const missingKey = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "1000000",
        outcome: "YES",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    const buy = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "1000000",
        outcome: "YES",
      },
      headers: {
        ...authHeaders(creator.provider, creator.providerUserId),
        "Idempotency-Key": `server-test:${creator.id}:buy`,
      },
      method: "POST",
    });
    const buyBody = await json<ApiResponse>(buy);

    expect(badQuote.status).toBe(400);
    expect(missingKey.status).toBe(400);
    expect(buy.status).toBe(201);
    expect(typeof buyBody.data.quote.costMicro).toBe("string");
    expect(buyBody.data.trade.userId).toBe(creator.id);
  });

  it("returns public portfolio and leaderboard reads", async () => {
    const user = await insertUser("portfolio");

    await creditRep({
      amountMicro: repToMicro(12n),
      db: client.db,
      idempotencyKey: `server-test:${user.id}:portfolio-fund`,
      sourceId: `server-test:${user.id}:portfolio-fund`,
      sourceType: "server_test_fund",
      userId: user.id,
    });

    const portfolio = await app.request(`/users/${user.id}/portfolio`);
    const portfolioBody = await json<ApiResponse>(portfolio);
    const leaderboard = await app.request("/leaderboard?limit=5");
    const leaderboardBody = await json<ApiResponse>(leaderboard);

    expect(portfolio.status).toBe(200);
    expect(portfolioBody.data.user.id).toBe(user.id);
    expect(portfolioBody.data.balance.availableAmountMicro).toBe(repToMicro(12n).toString());
    expect(leaderboard.status).toBe(200);
    expect(leaderboardBody.data.entries.length).toBeLessThanOrEqual(5);
    expect(typeof leaderboardBody.data.entries[0].balance.availableAmountMicro).toBe("string");
  });

  async function createMarket(provider: string, providerUserId: string) {
    const response = await requestJson("/markets", {
      body: {
        metadata: {
          source: "server-test",
        },
        slug: `server-test-${createId().toLowerCase()}`,
        title: "Will the API work?",
      },
      headers: authHeaders(provider, providerUserId),
      method: "POST",
    });
    const body = await json<ApiResponse>(response);

    expect(response.status).toBe(201);

    return body.data.market as {
      id: string;
      provider?: string;
      providerUserId?: string;
      status: string;
    };
  }

  async function insertUser(label: string) {
    const id = createId();
    const provider = "server-test";
    const providerUserId = `${label}-${id}`;

    const [user] = await client.db
      .insert(schema.users)
      .values({
        displayName: `Server Test ${label}`,
        id,
        provider,
        providerUserId,
      })
      .returning();

    if (!user) {
      throw new Error("Failed to create test user");
    }

    return user;
  }

  function requestJson(
    path: string,
    input: {
      body: unknown;
      headers?: Record<string, string>;
      method: "POST";
    },
  ) {
    return app.request(path, {
      body: JSON.stringify(input.body),
      headers: {
        "Content-Type": "application/json",
        ...input.headers,
      },
      method: input.method,
    });
  }
});

function authHeaders(provider: string, providerUserId: string) {
  return {
    "X-Provider": provider,
    "X-Provider-User-Id": providerUserId,
  };
}

type ApiResponse = {
  data?: any;
  error?: {
    code: string;
  };
};

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
