import { closeMarket, createBinaryMarket, getMarketById, openMarket } from "@habit-gamba/contracts";
import type {
  AutocompleteMarketsResponse,
  CancelMarketResponse,
  LeaderboardResponse,
  RefreshTradesResponse,
  RegisterAccountResponse,
  ResolveMarketResponse,
} from "@habit-gamba/api";
import type { DbClient } from "@habit-gamba/db";
import { createId, repToMicro, schema } from "@habit-gamba/db";
import { createExchange } from "@habit-gamba/exchange";
import { cancelMarket, previewCancelMarket, resolveMarket } from "@habit-gamba/resolution";
import { ensureSeedRepGrant, hasUserPermission, upsertUser } from "@habit-gamba/users";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";

import { requireInternalBot, requireUser, requireUserByProviderIdentity } from "./auth";
import { ApiError, errorBody, ok } from "./http";
import { findContractIdForOutcome } from "./market";
import { serverObservabilityMiddleware, type ServerObservability } from "./observability";
import { getLeaderboard, getPortfolio } from "./reads";
import {
  accountIdentitySchema,
  createMarketSchema,
  limitSchema,
  marketMetadataPatchSchema,
  marketRefreshQuerySchema,
  openMarketSchema,
  resolveMarketSchema,
  tradeSchema,
} from "./schemas";

const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });
const STARTER_REP_MICRO = repToMicro(1_000n);
const INITIAL_REFRESH_TRADE_LIMIT = 10;
const INCREMENTAL_REFRESH_TRADE_LIMIT = 25;

export function createApp(input: {
  botApiToken?: string | undefined;
  db: DbClient;
  observability?: ServerObservability | undefined;
  pingDb?: () => Promise<void>;
}) {
  const app = new Hono();

  if (input.observability) {
    app.use("*", serverObservabilityMiddleware(input.observability));
  }

  app.onError((error, context) => {
    const { body, status } = errorBody(error);

    return context.json(body, status as ContentfulStatusCode);
  });

  app.get("/health", (context) =>
    context.json(
      ok({
        ok: true,
        service: "server",
      }),
    ),
  );

  app.get("/health/db", async (context) => {
    await input.pingDb?.();

    return context.json(
      ok({
        ok: true,
        service: "postgres",
      }),
    );
  });

  app.get("/metrics", (context) => {
    if (!input.observability) {
      return context.text("# observability disabled\n");
    }

    return context.text(input.observability.metrics.render());
  });

  app.post("/accounts/register", async (context) => {
    requireInternalBot(context, input.botApiToken);

    const identity = accountIdentitySchema.parse(await context.req.json());
    const user = await upsertUser({
      db: input.db,
      displayName: identity.displayName,
      handle: identity.handle ?? null,
      metadata: { source: identity.provider },
      provider: identity.provider,
      providerUserId: identity.providerUserId,
    });
    const grant = await ensureSeedRepGrant({
      amountMicro: STARTER_REP_MICRO,
      db: input.db,
      idempotencyKey: `${identity.provider}:${identity.providerUserId}:starter-rep`,
      metadata: { starterGrant: true },
      sourceId: `${identity.provider}:${identity.providerUserId}:starter-rep`,
      userId: user.id,
    });

    const response = { balance: grant.balance, grant, user } satisfies RegisterAccountResponse;

    return context.json(ok(response), grant.idempotent ? 200 : 201);
  });

  app.get("/accounts/me", async (context) => {
    const user = await requireUser(context, input.db);

    return context.json(ok(await getPortfolio({ db: input.db, userId: user.id })));
  });

  app.get("/accounts/me/positions", async (context) => {
    const user = await requireUser(context, input.db);

    return context.json(ok(await exchange.listPositions({ db: input.db, userId: user.id })));
  });

  app.get("/markets", async (context) => {
    const actor = await optionalActor(
      input.db,
      context.req.header("X-Provider"),
      context.req.header("X-Provider-User-Id"),
    );
    const markets = await autocompleteMarkets({
      actor,
      db: input.db,
      query: context.req.query("query") ?? "",
      subcommand: context.req.query("subcommand"),
    });

    const response = { markets } satisfies AutocompleteMarketsResponse;

    return context.json(ok(response));
  });

  app.get("/markets/by-discord-thread/:threadId", async (context) => {
    requireInternalBot(context, input.botApiToken);

    // TODO: Move provider-specific lookups into an integration/provider API when bot APIs split.
    const threadId = context.req.param("threadId");
    const rows = await input.db
      .select({ id: schema.markets.id })
      .from(schema.markets)
      .where(sql`${schema.markets.metadata}->'discord'->>'threadId' = ${threadId}`)
      .orderBy(
        desc(schema.markets.updatedAt),
        desc(schema.markets.createdAt),
        desc(schema.markets.id),
      )
      .limit(2);
    const match = rows[0];

    if (!match) {
      throw new ApiError(404, "MARKET_NOT_FOUND", "Market not found", { threadId });
    }

    if (rows.length > 1) {
      input.observability?.logger.error("duplicate_discord_thread_market_metadata", {
        market_ids: rows.map((row) => row.id),
        thread_id: threadId,
      });
    }

    return context.json(
      ok(
        await exchange.getMarket({
          db: input.db,
          marketId: match.id,
        }),
      ),
    );
  });

  app.post("/markets", async (context) => {
    const user = await requireUser(context, input.db);
    const body = createMarketSchema.parse(await context.req.json());
    const result = await createBinaryMarket({
      creatorUserId: user.id,
      db: input.db,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      slug: body.slug ?? createSlug(body.title),
      title: body.title,
    });

    return context.json(ok(result), result.idempotent ? 200 : 201);
  });

  app.get("/markets/:id", async (context) => {
    const marketId = context.req.param("id");
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });

    return context.json(ok(market));
  });

  app.post("/markets/:id/open", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireMarketManager(input.db, context.req.param("id"), user.id);
    const body = openMarketSchema.parse(await context.req.json());
    const result = await openMarket({
      closesAt: body.closesAt,
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/close", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireMarketManager(input.db, context.req.param("id"), user.id);
    const result = await closeMarket({
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/quote", async (context) => {
    const marketId = context.req.param("id");
    const body = tradeSchema.parse(await context.req.json());
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    const contractId = findContractIdForOutcome(market, body.outcome);
    const result =
      body.mode === "target_shares"
        ? await exchange.quoteBuyShares({
            db: input.db,
            contractId,
            outcome: body.outcome,
            sharesMicro: body.amountMicro,
          })
        : await exchange.quoteBuy({
            amountMicro: body.amountMicro,
            contractId,
            db: input.db,
            outcome: body.outcome,
          });

    return context.json(ok(result));
  });

  app.post("/markets/:id/buy", async (context) => {
    const user = await requireUser(context, input.db);
    const idempotencyKey = context.req.header("Idempotency-Key")?.trim();

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
    }

    const marketId = context.req.param("id");
    const body = tradeSchema.parse(await context.req.json());
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    const contractId = findContractIdForOutcome(market, body.outcome);
    const result =
      body.mode === "target_shares"
        ? await exchange.buyShares({
            contractId,
            db: input.db,
            idempotencyKey,
            outcome: body.outcome,
            sharesMicro: body.amountMicro,
            userId: user.id,
          })
        : await exchange.buy({
            amountMicro: body.amountMicro,
            contractId,
            db: input.db,
            idempotencyKey,
            outcome: body.outcome,
            userId: user.id,
          });

    return context.json(ok(result), result.idempotent ? 200 : 201);
  });

  app.post("/markets/:id/resolve", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireMarketManager(input.db, context.req.param("id"), user.id);
    const body = resolveMarketSchema.parse(await context.req.json());
    const marketBeforeResolution = await exchange.getMarket({ db: input.db, marketId: market.id });
    const result = await resolveMarket({
      db: input.db,
      evidence: body.evidence ?? {},
      marketId: market.id,
      outcome: body.outcome,
      resolvedByUserId: user.id,
    });
    const resolvedMarket = await exchange.getMarket({ db: input.db, marketId: market.id });
    const marketView = {
      ...resolvedMarket,
      prices: marketBeforeResolution.prices,
    };
    const [updated] = await input.db
      .update(schema.markets)
      .set({
        metadata: mergeRecords(resolvedMarket.metadata, {
          settlementPrices: marketBeforeResolution.prices,
        }),
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    const response = {
      ...result,
      market: updated ? { ...marketView, metadata: updated.metadata } : marketView,
    } satisfies ResolveMarketResponse;

    return context.json(ok(response), result.idempotent ? 200 : 201);
  });

  app.post("/markets/:id/cancel/preview", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireMarketManager(input.db, context.req.param("id"), user.id);
    const result = await previewCancelMarket({
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/cancel", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireMarketManager(input.db, context.req.param("id"), user.id);
    const body = (await context.req.json()) as { reason?: unknown };

    if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Cancellation reason is required");
    }

    const result = await cancelMarket({
      db: input.db,
      marketId: market.id,
      reason: body.reason.trim(),
    });

    const response = {
      ...result,
      market: await exchange.getMarket({ db: input.db, marketId: market.id }),
    } satisfies CancelMarketResponse;

    return context.json(ok(response), result.idempotent ? 200 : 201);
  });

  app.get("/markets/:id/refresh-trades", async (context) => {
    requireInternalBot(context, input.botApiToken);

    const query = marketRefreshQuerySchema.parse({
      createdAt: context.req.query("createdAt"),
      id: context.req.query("id"),
    });
    const result = await listMarketRefreshTrades({
      db: input.db,
      lastTradeRefresh:
        query.createdAt && query.id ? { createdAt: query.createdAt, id: query.id } : null,
      marketId: context.req.param("id"),
    });

    const response = { trades: result } satisfies RefreshTradesResponse;

    return context.json(ok(response));
  });

  app.patch("/markets/:id/metadata", async (context) => {
    requireInternalBot(context, input.botApiToken);

    const market = await requireMarket(input.db, context.req.param("id"));
    const body = marketMetadataPatchSchema.parse(await context.req.json());
    const [updated] = await input.db
      .update(schema.markets)
      .set({
        metadata: mergeRecords(market.metadata, body.metadata),
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update market metadata");
    }

    return context.json(ok(updated));
  });

  app.get("/users/:id/portfolio", async (context) =>
    context.json(
      ok(
        await getPortfolio({
          db: input.db,
          userId: context.req.param("id"),
        }),
      ),
    ),
  );

  app.get("/leaderboard", async (context) => {
    const response = (await getLeaderboard(
      toLeaderboardInput(input.db, context.req.query("limit")),
    )) satisfies LeaderboardResponse;

    return context.json(ok(response));
  });

  return app;
}

function toLeaderboardInput(db: DbClient, rawLimit: string | undefined) {
  const limit = limitSchema.parse(rawLimit);

  return limit === undefined ? { db } : { db, limit };
}

type OptionalActor = {
  canManageMarkets: boolean;
  userId: string;
};

type LastTradeRefresh = {
  createdAt: string;
  id: string;
};

type TradeCursor = {
  createdAt: Date;
  id: string;
};

async function optionalActor(
  db: DbClient,
  provider: string | undefined,
  providerUserId: string | undefined,
): Promise<OptionalActor | undefined> {
  if (!provider?.trim() || !providerUserId?.trim()) {
    return undefined;
  }

  const user = await requireUserByProviderIdentity({
    db,
    provider: provider.trim(),
    providerUserId: providerUserId.trim(),
  }).catch(() => null);

  return user
    ? {
        canManageMarkets: await hasUserPermission({
          db,
          permission: "market.manage",
          userId: user.id,
        }),
        userId: user.id,
      }
    : undefined;
}

async function requireMarket(db: DbClient, marketId: string) {
  const market = await getMarketById({ db, marketId });

  if (!market) {
    throw new ApiError(404, "MARKET_NOT_FOUND", "Market not found", { marketId });
  }

  return market;
}

async function requireMarketManager(db: DbClient, marketId: string, userId: string) {
  const market = await requireMarket(db, marketId);
  const canManageMarkets = await hasUserPermission({
    db,
    permission: "market.manage",
    userId,
  });

  if (market.creatorUserId !== userId && !canManageMarkets) {
    throw new ApiError(403, "FORBIDDEN", "Only the market creator or a market admin may do this");
  }

  return market;
}

async function autocompleteMarkets(input: {
  actor?: OptionalActor | undefined;
  db: DbClient;
  query: string;
  subcommand?: string | undefined;
}) {
  const trimmed = input.query.trim();
  const queryWhere =
    trimmed.length === 0
      ? undefined
      : or(ilike(schema.markets.title, `%${trimmed}%`), ilike(schema.markets.slug, `%${trimmed}%`));
  const rows = await input.db
    .select()
    .from(schema.markets)
    .where(and(queryWhere, ...autocompletePolicy(input)))
    .orderBy(sql`${schema.markets.createdAt} desc`, sql`${schema.markets.id} desc`)
    .limit(25);
  const result = await Promise.all(
    rows.map((market) => getMarketById({ db: input.db, marketId: market.id })),
  );

  return result.flatMap((market) => (market ? [market] : []));
}

function autocompletePolicy(input: {
  actor?: OptionalActor | undefined;
  subcommand?: string | undefined;
}) {
  if (input.subcommand === "buy") {
    return [
      eq(schema.markets.status, "open"),
      input.actor ? ne(schema.markets.creatorUserId, input.actor.userId) : undefined,
    ];
  }

  if (isManagedAutocomplete(input.subcommand) && !input.actor?.canManageMarkets) {
    return [eq(schema.markets.creatorUserId, input.actor?.userId ?? "__missing_actor__")];
  }

  return [];
}

function isManagedAutocomplete(subcommand: string | undefined) {
  return (
    subcommand === "open" ||
    subcommand === "close" ||
    subcommand === "refresh" ||
    subcommand === "resolve" ||
    subcommand === "cancel"
  );
}

async function listMarketRefreshTrades(input: {
  db: DbClient;
  lastTradeRefresh?: LastTradeRefresh | null;
  marketId: string;
}) {
  const cursor = parseTradeCursor(input.lastTradeRefresh);
  const limit = cursor ? INCREMENTAL_REFRESH_TRADE_LIMIT : INITIAL_REFRESH_TRADE_LIMIT;
  const rows = await input.db
    .select({
      buyerDisplayName: schema.users.displayName,
      buyerHandle: schema.users.handle,
      cashDeltaMicro: schema.trades.cashDeltaMicro,
      createdAt: schema.trades.createdAt,
      id: schema.trades.id,
      outcome: schema.contracts.outcome,
      sharesDeltaMicro: schema.trades.sharesDeltaMicro,
    })
    .from(schema.trades)
    .innerJoin(schema.users, eq(schema.users.id, schema.trades.userId))
    .innerJoin(schema.contracts, eq(schema.contracts.id, schema.trades.contractId))
    .where(
      and(
        eq(schema.trades.marketId, input.marketId),
        eq(schema.trades.side, "buy"),
        cursor ? tradeAfterCursorWhere(cursor) : undefined,
      ),
    )
    .orderBy(
      cursor ? asc(schema.trades.createdAt) : desc(schema.trades.createdAt),
      cursor ? asc(schema.trades.id) : desc(schema.trades.id),
    )
    .limit(limit);
  const trades = rows.map((row) => ({
    buyerDisplayName: row.buyerDisplayName,
    buyerHandle: row.buyerHandle,
    cashDeltaMicro: row.cashDeltaMicro,
    createdAt: row.createdAt,
    id: row.id,
    outcome: row.outcome,
    sharesDeltaMicro: row.sharesDeltaMicro,
  }));

  return selectMarketRefreshTradesForPosting(trades, input.lastTradeRefresh);
}

function selectMarketRefreshTradesForPosting<T extends { createdAt: Date; id: string }>(
  trades: T[],
  lastTradeRefresh?: LastTradeRefresh | null,
) {
  const cursor = parseTradeCursor(lastTradeRefresh);
  const limit = cursor ? INCREMENTAL_REFRESH_TRADE_LIMIT : INITIAL_REFRESH_TRADE_LIMIT;
  const sorted = [...trades].sort(compareTradesAscending);
  const candidates = cursor ? sorted.filter((trade) => isTradeAfterCursor(trade, cursor)) : sorted;

  return cursor ? candidates.slice(0, limit) : candidates.slice(-limit);
}

function parseTradeCursor(marker: LastTradeRefresh | null | undefined): TradeCursor | null {
  if (!marker) {
    return null;
  }

  const createdAt = new Date(marker.createdAt);

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    createdAt,
    id: marker.id,
  };
}

function tradeAfterCursorWhere(cursor: TradeCursor) {
  return or(
    gt(schema.trades.createdAt, cursor.createdAt),
    and(eq(schema.trades.createdAt, cursor.createdAt), gt(schema.trades.id, cursor.id)),
  );
}

function isTradeAfterCursor(trade: { createdAt: Date; id: string }, cursor: TradeCursor) {
  const createdAtDiff = trade.createdAt.getTime() - cursor.createdAt.getTime();

  return createdAtDiff > 0 || (createdAtDiff === 0 && trade.id > cursor.id);
}

function compareTradesAscending(
  left: { createdAt: Date; id: string },
  right: { createdAt: Date; id: string },
) {
  const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}

function createSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${base || "market"}-${createId().slice(-6).toLowerCase()}`;
}

function mergeRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...left, ...right }).map(([key, value]) => {
      const leftValue = left[key];

      return [key, isRecord(leftValue) && isRecord(value) ? mergeRecords(leftValue, value) : value];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
