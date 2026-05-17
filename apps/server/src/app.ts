import { createBinaryMarket, getMarketById, openMarket } from "@habit-gamba/contracts";
import type { DbClient } from "@habit-gamba/db";
import { repToMicro } from "@habit-gamba/db";
import { createExchange } from "@habit-gamba/exchange";
import { resolveMarket } from "@habit-gamba/resolution";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { requireUser } from "./auth";
import { ApiError, errorBody, ok } from "./http";
import { findContractIdForOutcome } from "./market";
import { getLeaderboard, getPortfolio } from "./reads";
import {
  createMarketSchema,
  limitSchema,
  openMarketSchema,
  resolveMarketSchema,
  tradeSchema,
} from "./schemas";

const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });

export function createApp(input: { db: DbClient; pingDb?: () => Promise<void> }) {
  const app = new Hono();

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

  app.post("/markets", async (context) => {
    const user = await requireUser(context, input.db);
    const body = createMarketSchema.parse(await context.req.json());
    const result = await createBinaryMarket({
      creatorUserId: user.id,
      db: input.db,
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
      slug: body.slug,
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
    const market = await requireCreator(input.db, context.req.param("id"), user.id);
    const body = openMarketSchema.parse(await context.req.json());
    const result = await openMarket({
      closesAt: body.closesAt,
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
    const result = await exchange.quoteBuy({
      amountMicro: body.amountMicro,
      contractId: findContractIdForOutcome(market, body.outcome),
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
    const result = await exchange.buy({
      amountMicro: body.amountMicro,
      contractId: findContractIdForOutcome(market, body.outcome),
      db: input.db,
      idempotencyKey,
      outcome: body.outcome,
      userId: user.id,
    });

    return context.json(ok(result), result.idempotent ? 200 : 201);
  });

  app.post("/markets/:id/resolve", async (context) => {
    const user = await requireUser(context, input.db);
    const market = await requireCreator(input.db, context.req.param("id"), user.id);
    const body = resolveMarketSchema.parse(await context.req.json());
    const result = await resolveMarket({
      db: input.db,
      marketId: market.id,
      outcome: body.outcome,
      resolvedByUserId: user.id,
    });

    return context.json(ok(result), result.idempotent ? 200 : 201);
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

  app.get("/leaderboard", async (context) =>
    context.json(
      ok(await getLeaderboard(toLeaderboardInput(input.db, context.req.query("limit")))),
    ),
  );

  return app;
}

function toLeaderboardInput(db: DbClient, rawLimit: string | undefined) {
  const limit = limitSchema.parse(rawLimit);

  return limit === undefined ? { db } : { db, limit };
}

async function requireCreator(db: DbClient, marketId: string, userId: string) {
  const market = await getMarketById({ db, marketId });

  if (!market) {
    throw new ApiError(404, "MARKET_NOT_FOUND", "Market not found", { marketId });
  }

  if (market.creatorUserId !== userId) {
    throw new ApiError(403, "FORBIDDEN", "Only the market creator may perform this action");
  }

  return market;
}
