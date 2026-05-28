import { createId, schema } from "@habit-gamba/db";
import { eq } from "drizzle-orm";

import {
  MarketConflictError,
  MarketInvalidTransitionError,
  MarketNotFoundError,
  MarketResolutionUnsupportedError,
} from "./errors";
import { getMarketById, getMarketBySlug } from "./reads";
import { attachBinaryContracts } from "./shape";
import { withTransaction } from "./transaction";
import type {
  CloseMarketInput,
  CreateBinaryMarketInput,
  CreateBinaryMarketResult,
  DbTransaction,
  Market,
  MarketWithContracts,
  OpenMarketInput,
  VoidMarketInput,
} from "./types";

export async function createBinaryMarket(
  input: CreateBinaryMarketInput,
): Promise<CreateBinaryMarketResult> {
  return withTransaction(input, async (tx) => {
    const existingMarket = await getMarketBySlug({
      communityId: input.communityId,
      db: input.db,
      slug: input.slug,
      tx,
    });

    if (existingMarket) {
      assertSameCreatePayload(input, existingMarket);

      return {
        idempotent: true,
        market: existingMarket,
      };
    }

    const marketId = input.id ?? createId();
    const [market] = await tx
      .insert(schema.markets)
      .values({
        creatorUserId: input.creatorUserId,
        communityId: input.communityId,
        description: input.description ?? null,
        id: marketId,
        liquidityParameterMicro: 0n,
        metadata: input.metadata ?? {},
        slug: input.slug,
        status: "draft",
        title: input.title,
      })
      .returning();

    if (!market) {
      throw new Error("Failed to create market");
    }

    const contracts = await tx
      .insert(schema.contracts)
      .values([
        {
          id: input.yesContractId ?? createId(),
          marketId,
          outcome: "YES",
          title: "YES",
        },
        {
          id: input.noContractId ?? createId(),
          marketId,
          outcome: "NO",
          title: "NO",
        },
      ])
      .returning();

    return {
      idempotent: false,
      market: attachBinaryContracts(market, contracts),
    };
  });
}

export async function openMarket(input: OpenMarketInput): Promise<MarketWithContracts> {
  return withTransaction(input, async (tx) => {
    const market = await getExistingMarketForUpdate(tx, input.marketId);

    if (market.status !== "draft") {
      throw new MarketInvalidTransitionError({
        fromStatus: market.status,
        marketId: market.id,
        toStatus: "open",
      });
    }

    const openedAt = input.openedAt ?? new Date();

    if (input.closesAt <= openedAt) {
      throw new RangeError("closesAt must be after openedAt");
    }

    const [updatedMarket] = await tx
      .update(schema.markets)
      .set({
        closesAt: input.closesAt,
        openedAt,
        status: "open",
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    if (!updatedMarket) {
      throw new Error("Failed to open market");
    }

    return getRequiredMarketById(input.db, tx, updatedMarket.id);
  });
}

export async function closeMarket(input: CloseMarketInput): Promise<MarketWithContracts> {
  return withTransaction(input, async (tx) => {
    const market = await getExistingMarketForUpdate(tx, input.marketId);

    if (market.status !== "open") {
      throw new MarketInvalidTransitionError({
        fromStatus: market.status,
        marketId: market.id,
        toStatus: "closed",
      });
    }

    const [updatedMarket] = await tx
      .update(schema.markets)
      .set({
        closedAt: input.closedAt ?? new Date(),
        status: "closed",
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    if (!updatedMarket) {
      throw new Error("Failed to close market");
    }

    return getRequiredMarketById(input.db, tx, updatedMarket.id);
  });
}

export async function voidMarket(input: VoidMarketInput): Promise<MarketWithContracts> {
  return withTransaction(input, async (tx) => {
    const market = await getExistingMarketForUpdate(tx, input.marketId);

    if (market.status === "resolved" || market.status === "void") {
      throw new MarketInvalidTransitionError({
        fromStatus: market.status,
        marketId: market.id,
        toStatus: "void",
      });
    }

    const [updatedMarket] = await tx
      .update(schema.markets)
      .set({
        status: "void",
        updatedAt: new Date(),
        voidedAt: input.voidedAt ?? new Date(),
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    if (!updatedMarket) {
      throw new Error("Failed to void market");
    }

    return getRequiredMarketById(input.db, tx, updatedMarket.id);
  });
}

export async function resolveMarket(): Promise<never> {
  // TODO: Implement with betting, payout, refund, and ledger invariant semantics.
  throw new MarketResolutionUnsupportedError();
}

async function getExistingMarketForUpdate(tx: DbTransaction, marketId: string): Promise<Market> {
  const [market] = await tx
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .for("update")
    .limit(1);

  if (!market) {
    throw new MarketNotFoundError({ marketId });
  }

  return market;
}

async function getRequiredMarketById(
  db: OpenMarketInput["db"],
  tx: DbTransaction,
  marketId: string,
): Promise<MarketWithContracts> {
  const market = await getMarketById({ db, marketId, tx });

  if (!market) {
    throw new MarketNotFoundError({ marketId });
  }

  return market;
}

function assertSameCreatePayload(input: CreateBinaryMarketInput, market: MarketWithContracts) {
  const [yesContract, noContract] = market.contracts;

  if (
    market.creatorUserId !== input.creatorUserId ||
    market.communityId !== input.communityId ||
    market.description !== (input.description ?? null) ||
    market.title !== input.title ||
    yesContract.outcome !== "YES" ||
    yesContract.title !== "YES" ||
    noContract.outcome !== "NO" ||
    noContract.title !== "NO" ||
    stableJson(market.metadata) !== stableJson(input.metadata ?? {})
  ) {
    throw new MarketConflictError({ slug: input.slug });
  }
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
