import {
  closeMarket,
  createBinaryMarket,
  getMarketById,
  listMarkets,
  openMarket,
} from "@habit-gamba/contracts";
import { createId, repToMicro, schema } from "@habit-gamba/db";
import { createExchange } from "@habit-gamba/exchange";
import { cancelMarket, resolveMarket } from "@habit-gamba/resolution";
import { ensureSeedRepGrant, getUserByProviderIdentity, upsertUser } from "@habit-gamba/users";
import { getBalance } from "@habit-gamba/wallet";
import { eq, ilike, or, sql } from "drizzle-orm";

import { formatMicro, formatPercent, parseDecimalMicro } from "./money";
import { canManageMarket } from "./permissions";
import type { DbClient } from "@habit-gamba/db";
import type { ExchangeListPositionsResult } from "@habit-gamba/exchange";
import type { Actor } from "./permissions";
import type { ResolutionOutcome } from "@habit-gamba/resolution";

const DISCORD_PROVIDER = "discord";
const STARTER_REP_MICRO = repToMicro(1_000n);
const DEFAULT_LIQUIDITY_MICRO = repToMicro(100n);
const CANCEL_PENALTY_BPS = 1_000n;
const BPS_DENOMINATOR = 10_000n;

export type DiscordIdentity = {
  displayName: string;
  handle?: string | null;
  userId: string;
};

export type BotServices = {
  db: DbClient;
};

export async function ensureDiscordUser(input: BotServices & { identity: DiscordIdentity }) {
  return upsertUser({
    db: input.db,
    displayName: input.identity.displayName,
    handle: input.identity.handle ?? null,
    metadata: { discord: true },
    provider: DISCORD_PROVIDER,
    providerUserId: input.identity.userId,
  });
}

export async function getDiscordUser(input: BotServices & { discordUserId: string }) {
  return getUserByProviderIdentity({
    db: input.db,
    provider: DISCORD_PROVIDER,
    providerUserId: input.discordUserId,
  });
}

export async function registerAccount(input: BotServices & { identity: DiscordIdentity }) {
  const user = await ensureDiscordUser(input);
  const grant = await ensureSeedRepGrant({
    amountMicro: STARTER_REP_MICRO,
    db: input.db,
    idempotencyKey: `discord:${input.identity.userId}:starter-rep`,
    metadata: { discordStarterGrant: true },
    sourceId: `discord:${input.identity.userId}:starter-rep`,
    userId: user.id,
  });
  const balance = await getBalance({ db: input.db, userId: user.id });

  return {
    balance,
    grant,
    user,
  };
}

export async function getAccount(input: BotServices & { actor: Actor }) {
  return {
    balance: await getBalance({ db: input.db, userId: input.actor.userId }),
  };
}

export async function createMarketCommand(
  input: BotServices & {
    actor: Actor;
    closesAt?: Date;
    description?: string | null;
    openNow: boolean;
    slug?: string | null;
    title: string;
  },
) {
  const { market } = await createBinaryMarket({
    creatorUserId: input.actor.userId,
    db: input.db,
    description: input.description ?? null,
    metadata: {},
    slug: input.slug?.trim() || createSlug(input.title),
    title: input.title.trim(),
  });

  if (input.openNow) {
    if (!input.closesAt) {
      throw new RangeError("closes_at is required when open is true");
    }

    return {
      market: await openMarket({
        closesAt: input.closesAt,
        db: input.db,
        marketId: market.id,
      }),
      opened: true,
    };
  }

  return { market, opened: false };
}

export async function openMarketCommand(
  input: BotServices & {
    actor: Actor;
    closesAt: Date;
    marketId: string;
  },
) {
  const market = await requireMarket(input.db, input.marketId);
  assertMarketManager(input.actor, market);

  return openMarket({
    closesAt: input.closesAt,
    db: input.db,
    marketId: market.id,
  });
}

export async function closeMarketCommand(input: BotServices & { actor: Actor; marketId: string }) {
  const market = await requireMarket(input.db, input.marketId);
  assertMarketManager(input.actor, market);

  return closeMarket({
    db: input.db,
    marketId: market.id,
  });
}

export async function viewMarketCommand(input: BotServices & { marketId: string }) {
  const exchange = createExchange({ defaultLiquidityMicro: DEFAULT_LIQUIDITY_MICRO });
  return exchange.getMarket({ db: input.db, marketId: input.marketId });
}

export async function buyMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    mode: "spend_rep" | "target_shares";
    outcome: "NO" | "YES";
    value: string;
  },
) {
  const market = await viewMarketCommand(input);
  const contract = market.contracts.find((candidate) => candidate.outcome === input.outcome);

  if (!contract) {
    throw new Error(`Missing ${input.outcome} contract`);
  }

  const exchange = createExchange({ defaultLiquidityMicro: DEFAULT_LIQUIDITY_MICRO });
  const amountMicro = parseDecimalMicro(input.value, input.mode);
  const idempotencyKey = `discord:${input.actor.discordUserId}:buy:${createId()}`;

  return input.mode === "spend_rep"
    ? exchange.buy({
        amountMicro,
        contractId: contract.id,
        db: input.db,
        idempotencyKey,
        outcome: input.outcome,
        userId: input.actor.userId,
      })
    : exchange.buyShares({
        contractId: contract.id,
        db: input.db,
        idempotencyKey,
        outcome: input.outcome,
        sharesMicro: amountMicro,
        userId: input.actor.userId,
      });
}

export async function listPositionsCommand(
  input: BotServices & { actor: Actor },
): Promise<ExchangeListPositionsResult> {
  const exchange = createExchange({ defaultLiquidityMicro: DEFAULT_LIQUIDITY_MICRO });
  return exchange.listPositions({ db: input.db, userId: input.actor.userId });
}

export async function resolveMarketCommand(
  input: BotServices & {
    actor: Actor;
    evidence: Record<string, unknown>;
    marketId: string;
    outcome: ResolutionOutcome;
  },
) {
  const market = await requireMarket(input.db, input.marketId);
  assertMarketManager(input.actor, market);

  return resolveMarket({
    db: input.db,
    evidence: input.evidence,
    marketId: market.id,
    outcome: input.outcome,
    resolvedByUserId: input.actor.userId,
  });
}

export async function cancelMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    reason: string;
  },
) {
  const market = await requireMarket(input.db, input.marketId);
  assertMarketManager(input.actor, market);

  return cancelMarket({
    db: input.db,
    marketId: market.id,
    reason: input.reason,
  });
}

export async function autocompleteMarkets(input: BotServices & { query: string }) {
  const trimmed = input.query.trim();

  if (trimmed.length === 0) {
    const result = await listMarkets({ db: input.db, limit: 25 });
    return result.markets;
  }

  const rows = await input.db
    .select()
    .from(schema.markets)
    .where(
      or(ilike(schema.markets.title, `%${trimmed}%`), ilike(schema.markets.slug, `%${trimmed}%`)),
    )
    .orderBy(sql`${schema.markets.createdAt} desc`, sql`${schema.markets.id} desc`)
    .limit(25);
  const result = await Promise.all(
    rows.map((market) => getMarketById({ db: input.db, marketId: market.id })),
  );

  return result.flatMap((market) => (market ? [market] : []));
}

export async function writeMarketDiscordMetadata(
  input: BotServices & {
    marketId: string;
    metadata: Record<string, unknown>;
  },
) {
  const market = await requireMarket(input.db, input.marketId);

  await input.db
    .update(schema.markets)
    .set({
      metadata: {
        ...market.metadata,
        discord: {
          ...asRecord(market.metadata.discord),
          ...input.metadata,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.markets.id, input.marketId));
}

export function marketSummaryFields(market: {
  closesAt: Date | null;
  prices?: { no: number; yes: number };
  slug: string;
  status: string;
}) {
  return [
    { name: "Slug", value: market.slug, inline: true },
    { name: "Status", value: market.status, inline: true },
    {
      name: "Closes",
      value: market.closesAt ? market.closesAt.toISOString() : "not open",
      inline: true,
    },
    {
      name: "YES",
      value: market.prices ? formatPercent(market.prices.yes) : "50.0%",
      inline: true,
    },
    {
      name: "NO",
      value: market.prices ? formatPercent(market.prices.no) : "50.0%",
      inline: true,
    },
  ];
}

export function formatTradeSummary(input: {
  costMicro: bigint;
  outcome: string;
  sharesMicro: bigint;
  title: string;
}) {
  return `${input.outcome} ${formatMicro(input.sharesMicro, "contracts")} bought for ${formatMicro(input.costMicro)} on ${input.title}`;
}

export function calculateCancelPenalty(refundTotalMicro: bigint): bigint {
  return (refundTotalMicro * CANCEL_PENALTY_BPS) / BPS_DENOMINATOR;
}

function assertMarketManager(actor: Actor, market: { creatorUserId: string }) {
  if (!canManageMarket(actor, market)) {
    throw new Error("Only the market creator or a server admin can do this");
  }
}

async function requireMarket(db: DbClient, marketId: string) {
  const market = await getMarketById({ db, marketId });

  if (!market) {
    throw new Error("Market not found");
  }

  return market;
}

function createSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${base || "market"}-${createId().slice(-6).toLowerCase()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
