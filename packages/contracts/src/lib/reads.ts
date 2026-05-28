import { schema } from "@habit-gamba/db";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

import { attachBinaryContracts } from "./shape";
import type {
  GetMarketByIdInput,
  GetMarketBySlugInput,
  ListMarketsInput,
  ListMarketsResult,
  MarketContract,
  MarketWithContracts,
} from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function getMarketById(
  input: GetMarketByIdInput,
): Promise<MarketWithContracts | null> {
  const executor = input.tx ?? input.db;
  const [market] = await executor
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, input.marketId))
    .limit(1);

  if (!market) {
    return null;
  }

  return attachBinaryContracts(market, await getContracts(executor, [market.id]));
}

export async function getMarketBySlug(
  input: GetMarketBySlugInput,
): Promise<MarketWithContracts | null> {
  const executor = input.tx ?? input.db;
  const [market] = await executor
    .select()
    .from(schema.markets)
    .where(
      and(eq(schema.markets.communityId, input.communityId), eq(schema.markets.slug, input.slug)),
    )
    .limit(1);

  if (!market) {
    return null;
  }

  return attachBinaryContracts(market, await getContracts(executor, [market.id]));
}

export async function listMarkets(input: ListMarketsInput): Promise<ListMarketsResult> {
  const executor = input.tx ?? input.db;
  const limit = normalizeLimit(input.limit);
  const where = and(
    input.creatorUserId ? eq(schema.markets.creatorUserId, input.creatorUserId) : undefined,
    input.communityId ? eq(schema.markets.communityId, input.communityId) : undefined,
    input.statuses && input.statuses.length > 0
      ? inArray(schema.markets.status, input.statuses)
      : undefined,
    input.cursor
      ? or(
          lt(schema.markets.createdAt, input.cursor.createdAt),
          and(
            eq(schema.markets.createdAt, input.cursor.createdAt),
            lt(schema.markets.id, input.cursor.id),
          ),
        )
      : undefined,
  );

  const rows = await executor
    .select()
    .from(schema.markets)
    .where(where)
    .orderBy(desc(schema.markets.createdAt), desc(schema.markets.id))
    .limit(limit + 1);

  const markets = rows.slice(0, limit);
  const marketIds = markets.map((market) => market.id);
  const contractsByMarketId = groupContractsByMarketId(await getContracts(executor, marketIds));
  const lastMarket = markets.at(-1);
  const hasNextPage = rows.length > limit;

  return {
    markets: markets.map((market) =>
      attachBinaryContracts(market, contractsByMarketId.get(market.id) ?? []),
    ),
    nextCursor:
      hasNextPage && lastMarket
        ? {
            createdAt: lastMarket.createdAt,
            id: lastMarket.id,
          }
        : null,
  };
}

async function getContracts(
  db: GetMarketByIdInput["db"] | NonNullable<GetMarketByIdInput["tx"]>,
  marketIds: string[],
): Promise<MarketContract[]> {
  if (marketIds.length === 0) {
    return [];
  }

  return db.select().from(schema.contracts).where(inArray(schema.contracts.marketId, marketIds));
}

function groupContractsByMarketId(contracts: MarketContract[]): Map<string, MarketContract[]> {
  const contractsByMarketId = new Map<string, MarketContract[]>();

  for (const contract of contracts) {
    const existingContracts = contractsByMarketId.get(contract.marketId) ?? [];
    existingContracts.push(contract);
    contractsByMarketId.set(contract.marketId, existingContracts);
  }

  return contractsByMarketId;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }

  return Math.min(limit, MAX_LIMIT);
}
