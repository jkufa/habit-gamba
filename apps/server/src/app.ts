import { closeMarket, createBinaryMarket, getMarketById, openMarket } from "@habit-gamba/contracts";
import type {
  AccountAdjustmentResponse,
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
import { scheduleMarketReminderDeliveries } from "@habit-gamba/reminders";
import { createRecurringMarketSeries, endRecurringMarketSeries } from "@habit-gamba/recurring";
import { cancelMarket, previewCancelMarket, resolveMarket } from "@habit-gamba/resolution";
import {
  ensureCommunityMembership,
  ensureSeedRepGrant,
  getCommunityMembership,
  getUserById,
  grantUserRole,
  hasUserPermission,
  upsertCommunity,
  upsertUser,
} from "@habit-gamba/users";
import { creditRep, penalizeRep } from "@habit-gamba/wallet";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, asc, desc, eq, gt, ilike, ne, or, sql } from "drizzle-orm";

import {
  requireCommunity,
  requireInternalBot,
  requireUserByProviderIdentity,
  requireUserWithCommunity,
} from "./auth";
import { ApiError, errorBody, ok } from "./http";
import { findContractIdForOutcome } from "./market";
import { serverObservabilityMiddleware, type ServerObservability } from "./observability";
import { getLeaderboard, getPortfolio } from "./reads";
import {
  accountIdentitySchema,
  accountAdjustmentSchema,
  createRecurringMarketSeriesSchema,
  endRecurringMarketSeriesSchema,
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
    const { grant, user } = await input.db.transaction(async (tx) => {
      const community = await upsertCommunity({
        db: input.db,
        displayName: identity.communityDisplayName,
        provider: identity.communityProvider,
        providerCommunityId: identity.providerCommunityId,
        slug: createCommunitySlug(identity.communityDisplayName, identity.providerCommunityId),
        tx,
      });
      const user = await upsertUser({
        db: input.db,
        displayName: identity.displayName,
        handle: identity.handle ?? null,
        metadata: { source: identity.provider },
        provider: identity.provider,
        providerUserId: identity.providerUserId,
        tx,
      });

      await ensureCommunityMembership({
        communityId: community.id,
        db: input.db,
        displayNameSnapshot: identity.displayName,
        metadata: { source: identity.provider },
        providerMemberId: identity.providerUserId,
        tx,
        userId: user.id,
      });

      const grant = await ensureSeedRepGrant({
        amountMicro: STARTER_REP_MICRO,
        communityId: community.id,
        db: input.db,
        idempotencyKey: `${identity.communityProvider}:${identity.providerCommunityId}:${identity.provider}:${identity.providerUserId}:starter-rep`,
        metadata: { starterGrant: true },
        sourceId: `${identity.communityProvider}:${identity.providerCommunityId}:${identity.provider}:${identity.providerUserId}:starter-rep`,
        tx,
        userId: user.id,
      });

      return { grant, user };
    });

    if (identity.admin) {
      await grantUserRole({ db: input.db, role: "admin", userId: user.id });
    }

    const response = { balance: grant.balance, grant, user } satisfies RegisterAccountResponse;

    return context.json(ok(response), grant.idempotent ? 200 : 201);
  });

  app.get("/accounts/me", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);

    return context.json(
      ok(await getPortfolio({ communityId: community.id, db: input.db, userId: user.id })),
    );
  });

  app.post("/accounts/:userId/adjustments", async (context) => {
    const { community, user: actor } = await requireUserWithCommunity(context, input.db);
    await requireAccountAdjuster(input.db, actor.id);

    const idempotencyKey = context.req.header("Idempotency-Key")?.trim();

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
    }

    const targetUserId = context.req.param("userId");
    const targetUser = await getUserById({ db: input.db, userId: targetUserId });

    if (!targetUser || targetUser.status !== "active") {
      throw new ApiError(404, "USER_NOT_FOUND", "Target user was not found", {
        userId: targetUserId,
      });
    }
    const targetMembership = await getCommunityMembership({
      communityId: community.id,
      db: input.db,
      userId: targetUser.id,
    });

    if (!targetMembership) {
      throw new ApiError(404, "USER_NOT_FOUND", "Target user was not found in this community", {
        communityId: community.id,
        userId: targetUser.id,
      });
    }

    const body = accountAdjustmentSchema.parse(await context.req.json());
    const sourceId = `account-adjustment:${idempotencyKey}`;
    const metadata = {
      actorUserId: actor.id,
      direction: body.direction,
      reason: body.reason,
      source: "discord_admin_command",
    };
    const result =
      body.direction === "credit"
        ? await creditRep({
            amountMicro: body.amountMicro,
            communityId: community.id,
            db: input.db,
            idempotencyKey,
            metadata,
            sourceId,
            sourceType: "account_adjustment",
            userId: targetUser.id,
          })
        : await penalizeRep({
            amountMicro: body.amountMicro,
            communityId: community.id,
            db: input.db,
            idempotencyKey,
            metadata,
            sourceId,
            sourceType: "account_adjustment",
            userId: targetUser.id,
          });

    const response = {
      balance: result.balance,
      idempotent: result.idempotent,
      ledgerEntry: result.ledgerEntry,
      user: targetUser,
    } satisfies AccountAdjustmentResponse;

    return context.json(ok(response), result.idempotent ? 200 : 201);
  });

  app.get("/accounts/me/positions", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);

    return context.json(
      ok(
        await exchange.listPositions({ communityId: community.id, db: input.db, userId: user.id }),
      ),
    );
  });

  app.get("/markets", async (context) => {
    const community = await requireCommunity(context, input.db);
    const actor = await optionalActor(
      input.db,
      community.id,
      context.req.header("X-Provider"),
      context.req.header("X-Provider-User-Id"),
    );
    const markets = await autocompleteMarkets({
      actor,
      communityId: community.id,
      db: input.db,
      query: context.req.query("query") ?? "",
      subcommand: context.req.query("subcommand"),
    });

    const response = { markets } satisfies AutocompleteMarketsResponse;

    return context.json(ok(response));
  });

  app.get("/markets/by-discord-thread/:threadId", async (context) => {
    requireInternalBot(context, input.botApiToken);
    const community = await requireCommunity(context, input.db);

    // TODO: Move provider-specific lookups into an integration/provider API when bot APIs split.
    const threadId = context.req.param("threadId");
    const rows = await input.db
      .select({ id: schema.markets.id })
      .from(schema.markets)
      .where(
        and(
          eq(schema.markets.communityId, community.id),
          sql`${schema.markets.metadata}->'discord'->>'threadId' = ${threadId}`,
        ),
      )
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
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const body = createMarketSchema.parse(await context.req.json());
    const result = await createBinaryMarket({
      communityId: community.id,
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
    const community = await requireCommunity(context, input.db);
    const marketId = context.req.param("id");
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    assertMarketCommunity(market, community.id);

    return context.json(ok(market));
  });

  app.post("/markets/:id/open", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
    const body = openMarketSchema.parse(await context.req.json());
    const result = await openMarket({
      closesAt: body.closesAt,
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/recurring-series", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
    const body = createRecurringMarketSeriesSchema.parse(await context.req.json());
    const result = await createRecurringMarketSeries({
      creatorUserId: market.creatorUserId,
      daysOfWeekMask: body.daysOfWeekMask,
      db: input.db,
      endsOn: body.endsOn ?? null,
      marketId: market.id,
      metadata: body.metadata ?? {},
    });

    return context.json(
      ok({
        ...result,
        firstMarket: result.firstMarket
          ? await exchange.getMarket({ db: input.db, marketId: result.firstMarket.id })
          : null,
      }),
      201,
    );
  });

  app.post("/recurring-market-series/:id/end", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const series = await requireRecurringSeriesManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
    const body = endRecurringMarketSeriesSchema.parse(await context.req.json());
    const result = await endRecurringMarketSeries({
      db: input.db,
      endedByUserId: user.id,
      reason: body.reason ?? null,
      seriesId: series.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/close", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    await requireMarketAdmin(input.db, user.id, community.id);
    const market = await requireMarket(input.db, context.req.param("id"), community.id);
    const result = await closeMarket({
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/quote", async (context) => {
    const community = await requireCommunity(context, input.db);
    const marketId = context.req.param("id");
    const body = tradeSchema.parse(await context.req.json());
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    assertMarketCommunity(market, community.id);
    const contractId = findContractIdForOutcome(market, body.outcome);
    const mode = body.mode as string;
    const result =
      mode === "buy_shares"
        ? await exchange.quoteBuyShares({
            db: input.db,
            contractId,
            outcome: body.outcome,
            sharesMicro: body.amountMicro,
          })
        : mode === "sell_shares"
          ? await exchange.quoteSell({
              db: input.db,
              contractId,
              outcome: body.outcome,
              sharesMicro: body.amountMicro,
              userId: (await requireUserWithCommunity(context, input.db)).user.id,
            })
          : mode === "target_rep"
            ? await exchange.quoteSellForRep({
                db: input.db,
                contractId,
                outcome: body.outcome,
                targetRepMicro: body.amountMicro,
                userId: (await requireUserWithCommunity(context, input.db)).user.id,
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
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const idempotencyKey = context.req.header("Idempotency-Key")?.trim();

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
    }

    const marketId = context.req.param("id");
    const body = tradeSchema.parse(await context.req.json());
    if (body.mode === "sell_shares" || body.mode === "target_rep") {
      throw new ApiError(400, "INVALID_TRADE_MODE", "Buy endpoint requires a buy mode");
    }
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    assertMarketCommunity(market, community.id);
    const contractId = findContractIdForOutcome(market, body.outcome);
    const result =
      body.mode === "buy_shares"
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

  app.post("/markets/:id/sell", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const idempotencyKey = context.req.header("Idempotency-Key")?.trim();

    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
    }

    const marketId = context.req.param("id");
    const body = tradeSchema.parse(await context.req.json());
    if (body.mode === "spend_rep" || body.mode === "buy_shares") {
      throw new ApiError(400, "INVALID_TRADE_MODE", "Sell endpoint requires a sell mode");
    }
    const market = await exchange.getMarket({
      db: input.db,
      marketId,
    });
    assertMarketCommunity(market, community.id);
    const contractId = findContractIdForOutcome(market, body.outcome);
    const result =
      body.mode === "target_rep"
        ? await exchange.sellForRep({
            contractId,
            db: input.db,
            idempotencyKey,
            outcome: body.outcome,
            targetRepMicro: body.amountMicro,
            userId: user.id,
          })
        : await exchange.sell({
            contractId,
            db: input.db,
            idempotencyKey,
            outcome: body.outcome,
            sharesMicro: body.amountMicro,
            userId: user.id,
          });

    return context.json(ok(result), result.idempotent ? 200 : 201);
  });

  app.post("/markets/:id/resolve", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
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
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
    const result = await previewCancelMarket({
      db: input.db,
      marketId: market.id,
    });

    return context.json(ok(result));
  });

  app.post("/markets/:id/cancel", async (context) => {
    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
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

    const { community, user } = await requireUserWithCommunity(context, input.db);
    const market = await requireMarketManager(
      input.db,
      context.req.param("id"),
      user.id,
      community.id,
    );
    const query = marketRefreshQuerySchema.parse({
      createdAt: context.req.query("createdAt"),
      id: context.req.query("id"),
    });
    const result = await listMarketRefreshTrades({
      db: input.db,
      lastTradeRefresh:
        query.createdAt && query.id ? { createdAt: query.createdAt, id: query.id } : null,
      marketId: market.id,
    });

    const response = { trades: result } satisfies RefreshTradesResponse;

    return context.json(ok(response));
  });

  app.patch("/markets/:id/metadata", async (context) => {
    requireInternalBot(context, input.botApiToken);

    const community = await requireCommunity(context, input.db);
    const market = await requireMarket(input.db, context.req.param("id"), community.id);
    const body = marketMetadataPatchSchema.parse(await context.req.json());
    const updated = await input.db.transaction(async (tx) => {
      const [updatedMarket] = await tx
        .update(schema.markets)
        .set({
          metadata: mergeRecords(market.metadata, body.metadata),
          updatedAt: new Date(),
        })
        .where(eq(schema.markets.id, market.id))
        .returning();

      if (!updatedMarket) {
        throw new Error("Failed to update market metadata");
      }

      await scheduleMarketReminderDeliveries({
        db: tx,
        market: updatedMarket,
      });

      return updatedMarket;
    });

    return context.json(ok(updated));
  });

  app.get("/users/:id/portfolio", async (context) =>
    context.json(
      ok(
        await getPortfolio({
          communityId: (await requireCommunity(context, input.db)).id,
          db: input.db,
          userId: context.req.param("id"),
        }),
      ),
    ),
  );

  app.get("/leaderboard", async (context) => {
    const community = await requireCommunity(context, input.db);
    const response = (await getLeaderboard(
      toLeaderboardInput(input.db, community.id, context.req.query("limit")),
    )) satisfies LeaderboardResponse;

    return context.json(ok(response));
  });

  return app;
}

function toLeaderboardInput(db: DbClient, communityId: string, rawLimit: string | undefined) {
  const limit = limitSchema.parse(rawLimit);

  return limit === undefined ? { communityId, db } : { communityId, db, limit };
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
  communityId: string,
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
          communityId,
          db,
          permission: "market.manage",
          userId: user.id,
        }),
        userId: user.id,
      }
    : undefined;
}

async function requireMarket(db: DbClient, marketId: string, communityId?: string) {
  const market = await getMarketById({ db, marketId });

  if (!market) {
    throw new ApiError(404, "MARKET_NOT_FOUND", "Market not found", { marketId });
  }

  if (communityId) {
    assertMarketCommunity(market, communityId);
  }

  return market;
}

async function requireMarketManager(
  db: DbClient,
  marketId: string,
  userId: string,
  communityId: string,
) {
  const market = await requireMarket(db, marketId, communityId);
  const canManageMarkets = await hasUserPermission({
    communityId,
    db,
    permission: "market.manage",
    userId,
  });

  if (market.creatorUserId !== userId && !canManageMarkets) {
    throw new ApiError(403, "FORBIDDEN", "Only the market creator or a market admin may do this");
  }

  return market;
}

async function requireMarketAdmin(db: DbClient, userId: string, communityId: string) {
  const canManageMarkets = await hasUserPermission({
    communityId,
    db,
    permission: "market.manage",
    userId,
  });

  if (!canManageMarkets) {
    throw new ApiError(403, "FORBIDDEN", "Only a market admin may do this");
  }
}

async function requireRecurringSeriesManager(
  db: DbClient,
  seriesId: string,
  userId: string,
  communityId: string,
) {
  const [series] = await db
    .select()
    .from(schema.recurringMarketSeries)
    .where(eq(schema.recurringMarketSeries.id, seriesId))
    .limit(1);

  if (!series) {
    throw new ApiError(404, "RECURRING_SERIES_NOT_FOUND", "Recurring market series not found", {
      seriesId,
    });
  }
  const sourceMarket = await requireMarket(db, series.sourceMarketId, communityId);

  const canManageMarkets = await hasUserPermission({
    communityId,
    db,
    permission: "market.manage",
    userId,
  });

  if (sourceMarket.creatorUserId !== userId && !canManageMarkets) {
    throw new ApiError(403, "FORBIDDEN", "Only the series creator or a market admin may do this");
  }

  return series;
}

async function requireAccountAdjuster(db: DbClient, userId: string) {
  const canAdjustAccounts = await hasUserPermission({
    db,
    permission: "account.adjust",
    userId,
  });

  if (!canAdjustAccounts) {
    throw new ApiError(403, "FORBIDDEN", "Only an admin may adjust account balances");
  }
}

async function autocompleteMarkets(input: {
  actor?: OptionalActor | undefined;
  communityId: string;
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
    .where(
      and(
        eq(schema.markets.communityId, input.communityId),
        queryWhere,
        ...autocompletePolicy(input),
      ),
    )
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
    subcommand === "schedule" ||
    subcommand === "resolve" ||
    subcommand === "cancel" ||
    subcommand === "end" ||
    subcommand === "manage"
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
      actorDisplayName: schema.users.displayName,
      actorHandle: schema.users.handle,
      cashDeltaMicro: schema.trades.cashDeltaMicro,
      createdAt: schema.trades.createdAt,
      id: schema.trades.id,
      outcome: schema.contracts.outcome,
      sharesDeltaMicro: schema.trades.sharesDeltaMicro,
      side: schema.trades.side,
    })
    .from(schema.trades)
    .innerJoin(schema.users, eq(schema.users.id, schema.trades.userId))
    .innerJoin(schema.contracts, eq(schema.contracts.id, schema.trades.contractId))
    .where(
      and(
        eq(schema.trades.marketId, input.marketId),
        cursor ? tradeAfterCursorWhere(cursor) : undefined,
      ),
    )
    .orderBy(
      cursor ? asc(schema.trades.createdAt) : desc(schema.trades.createdAt),
      cursor ? asc(schema.trades.id) : desc(schema.trades.id),
    )
    .limit(limit);
  const trades = rows.map((row) => ({
    actorDisplayName: row.actorDisplayName,
    actorHandle: row.actorHandle,
    cashDeltaMicro: row.cashDeltaMicro,
    createdAt: row.createdAt,
    id: row.id,
    outcome: row.outcome,
    sharesDeltaMicro: row.sharesDeltaMicro,
    side: row.side,
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

function createCommunitySlug(displayName: string, providerCommunityId: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const suffix = providerCommunityId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-8);

  return `${base || "community"}-${suffix || createId().slice(-6).toLowerCase()}`;
}

function assertMarketCommunity(
  market: { communityId: string | null; id: string },
  communityId: string,
) {
  if (market.communityId !== communityId) {
    throw new ApiError(404, "MARKET_NOT_FOUND", "Market not found", { marketId: market.id });
  }
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
