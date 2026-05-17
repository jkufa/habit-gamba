import { createId, schema } from "@habit-gamba/db";
import { debitRep } from "@habit-gamba/wallet";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  ExchangeConfigError,
  ExchangeIdempotencyConflictError,
  ExchangeMarketNotFoundError,
  MarketNotTradeableError,
} from "./errors";
import { getPrices, quoteBuy as quoteLmsrBuy, quoteBuyShares as quoteLmsrBuyShares } from "./lmsr";
import type {
  ExchangeBuyInput,
  ExchangeBuyResult,
  ExchangeBuySharesInput,
  ExchangeConfig,
  ExchangeExecutor,
  ExchangeGetMarketInput,
  ExchangeListPositionsInput,
  ExchangeListPositionsResult,
  ExchangeMarketView,
  ExchangeQuoteBuyInput,
  ExchangeQuoteBuySharesInput,
  ExchangeQuoteResult,
  ExchangeService,
  Market,
  MarketContract,
  Position,
  Trade,
} from "./types";
import type { LmsrMarketState, LmsrQuote } from "./lmsr";

const TRADE_LEDGER_SOURCE_TYPE = "exchange_trade";

type BuyPayload = {
  contractId: string;
  outcome: "NO" | "YES";
  spendMicro?: string;
  targetSharesMicro?: string;
  userId: string;
};

type TradeMetadata = {
  buyPayload?: BuyPayload;
  quote?: SerializedQuote;
};

type SerializedQuote = {
  costMicro: string;
  outcome: "NO" | "YES";
  pricesAfter: {
    no: number;
    yes: number;
  };
  pricesBefore: {
    no: number;
    yes: number;
  };
  sharesMicro: string;
};

export function createExchange(config: ExchangeConfig): ExchangeService {
  if (config.defaultLiquidityMicro <= 0n) {
    throw new ExchangeConfigError("defaultLiquidityMicro must be positive");
  }

  return {
    buy: (input) => buy(config, input),
    buyShares: (input) => buyShares(config, input),
    getMarket: (input) => getMarket(config, input),
    listPositions: (input) => listPositions(config, input),
    quoteBuy: (input) => quoteBuy(config, input),
    quoteBuyShares: (input) => quoteBuyShares(config, input),
  };
}

async function quoteBuy(
  config: ExchangeConfig,
  input: ExchangeQuoteBuyInput,
): Promise<ExchangeQuoteResult> {
  const now = input.now ?? new Date();
  const loaded = await loadMarketByContractId(input.db, input.contractId);

  assertAcceptsBets(loaded.market, now);

  const quote = quoteLmsrBuy(
    toLmsrState(config, loaded.contracts),
    input.outcome,
    input.amountMicro,
  );

  return {
    ...quote,
    market: toMarketView(config, loaded.market, loaded.contracts),
  };
}

async function quoteBuyShares(
  config: ExchangeConfig,
  input: ExchangeQuoteBuySharesInput,
): Promise<ExchangeQuoteResult> {
  const now = input.now ?? new Date();
  const loaded = await loadMarketByContractId(input.db, input.contractId);

  assertAcceptsBets(loaded.market, now);

  const quote = quoteLmsrBuyShares(
    toLmsrState(config, loaded.contracts),
    input.outcome,
    input.sharesMicro,
  );

  return {
    ...quote,
    market: toMarketView(config, loaded.market, loaded.contracts),
  };
}

async function getMarket(
  config: ExchangeConfig,
  input: ExchangeGetMarketInput,
): Promise<ExchangeMarketView> {
  return getMarketView(config, input.db, input);
}

async function listPositions(
  config: ExchangeConfig,
  input: ExchangeListPositionsInput,
): Promise<ExchangeListPositionsResult> {
  const limit = normalizePositionLimit(input.limit);
  const positions = await input.db
    .select()
    .from(schema.positions)
    .where(
      and(eq(schema.positions.userId, input.userId), sql`${schema.positions.quantityMicro} > 0`),
    )
    .orderBy(desc(schema.positions.updatedAt), desc(schema.positions.id))
    .limit(limit);
  const contractIds = positions.map((position) => position.contractId);

  if (contractIds.length === 0) {
    return { positions: [] };
  }

  const contracts = await input.db
    .select()
    .from(schema.contracts)
    .where(inArray(schema.contracts.id, contractIds));
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const marketIds = [...new Set(contracts.map((contract) => contract.marketId))];
  const marketViews = await Promise.all(
    marketIds.map((marketId) => getMarketView(config, input.db, { marketId })),
  );
  const marketsById = new Map(marketViews.map((market) => [market.id, market]));

  return {
    positions: positions.flatMap((position) => {
      const contract = contractsById.get(position.contractId);
      const market = contract ? marketsById.get(contract.marketId) : undefined;

      return contract && market ? [{ contract, market, position }] : [];
    }),
  };
}

async function buy(config: ExchangeConfig, input: ExchangeBuyInput): Promise<ExchangeBuyResult> {
  return executeBuy(config, input, {
    payload: {
      contractId: input.contractId,
      outcome: input.outcome,
      spendMicro: input.amountMicro.toString(),
      userId: input.userId,
    },
    quote: (contracts) =>
      quoteLmsrBuy(toLmsrState(config, contracts), input.outcome, input.amountMicro),
  });
}

async function buyShares(
  config: ExchangeConfig,
  input: ExchangeBuySharesInput,
): Promise<ExchangeBuyResult> {
  return executeBuy(config, input, {
    payload: {
      contractId: input.contractId,
      outcome: input.outcome,
      targetSharesMicro: input.sharesMicro.toString(),
      userId: input.userId,
    },
    quote: (contracts) =>
      quoteLmsrBuyShares(toLmsrState(config, contracts), input.outcome, input.sharesMicro),
  });
}

async function executeBuy(
  config: ExchangeConfig,
  input: ExchangeBuyInput | ExchangeBuySharesInput,
  options: {
    payload: BuyPayload;
    quote: (contracts: [MarketContract, MarketContract]) => LmsrQuote;
  },
): Promise<ExchangeBuyResult> {
  return input.db.transaction(async (tx) => {
    const existingTrade = await findExistingTrade(tx, input.idempotencyKey);

    if (existingTrade) {
      return getIdempotentBuyResult(
        config,
        tx,
        input.idempotencyKey,
        options.payload,
        existingTrade,
      );
    }

    const now = input.now ?? new Date();
    const loaded = await loadMarketByContractId(tx, input.contractId, { lock: true });

    assertAcceptsBets(loaded.market, now);

    const quote = options.quote(loaded.contracts);
    const boughtContract = getContractByOutcome(loaded.contracts, input.outcome);
    const tradeId = createId();
    const ledger = await debitRep({
      amountMicro: quote.costMicro,
      db: input.db,
      idempotencyKey: ledgerIdempotencyKey(input.idempotencyKey),
      metadata: {
        contractId: boughtContract.id,
        marketId: loaded.market.id,
        outcome: input.outcome,
        tradeId,
      },
      sourceId: input.idempotencyKey,
      sourceType: TRADE_LEDGER_SOURCE_TYPE,
      tx,
      userId: input.userId,
    });

    const [trade] = await tx
      .insert(schema.trades)
      .values({
        cashDeltaMicro: -quote.costMicro,
        contractId: boughtContract.id,
        feeMicro: 0n,
        id: tradeId,
        idempotencyKey: input.idempotencyKey,
        marketId: loaded.market.id,
        metadata: {
          buyPayload: options.payload,
          quote: serializeQuote(quote),
        },
        sharesDeltaMicro: quote.sharesMicro,
        side: "buy",
        userId: input.userId,
      })
      .onConflictDoNothing({
        target: schema.trades.idempotencyKey,
      })
      .returning();

    if (!trade) {
      const concurrentTrade = await findExistingTrade(tx, input.idempotencyKey);

      if (!concurrentTrade) {
        throw new Error("Failed to create trade");
      }

      return getIdempotentBuyResult(
        config,
        tx,
        input.idempotencyKey,
        options.payload,
        concurrentTrade,
      );
    }

    const position = await upsertPosition(tx, {
      contractId: boughtContract.id,
      sharesMicro: quote.sharesMicro,
      userId: input.userId,
    });

    await incrementContractSupply(tx, boughtContract.id, quote.sharesMicro);

    const market = await getMarketView(config, tx, {
      marketId: loaded.market.id,
    });

    return {
      idempotent: false,
      ledgerEntry: ledger.ledgerEntry,
      market,
      position,
      quote,
      trade,
    };
  });
}

async function getIdempotentBuyResult(
  config: ExchangeConfig,
  tx: ExchangeExecutor,
  idempotencyKey: string,
  expectedPayload: BuyPayload,
  trade: Trade,
): Promise<ExchangeBuyResult> {
  const metadata = asTradeMetadata(trade.metadata);

  if (!isSameBuyPayload(metadata.buyPayload, expectedPayload)) {
    throw new ExchangeIdempotencyConflictError({ idempotencyKey });
  }

  const [ledgerEntry] = await tx
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.idempotencyKey, ledgerIdempotencyKey(idempotencyKey)))
    .limit(1);

  if (!ledgerEntry) {
    throw new Error("Existing exchange trade is missing ledger entry");
  }

  const [position] = await tx
    .select()
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.userId, expectedPayload.userId),
        eq(schema.positions.contractId, trade.contractId),
      ),
    )
    .limit(1);

  if (!position) {
    throw new Error("Existing exchange trade is missing position");
  }

  const quote = metadata.quote ? deserializeQuote(metadata.quote) : failMissingQuote();
  const market = await getMarketView(config, tx, {
    marketId: trade.marketId,
  });

  return {
    idempotent: true,
    ledgerEntry,
    market,
    position,
    quote,
    trade,
  };
}

async function loadMarketByContractId(
  db: ExchangeExecutor,
  contractId: string,
  options: { lock?: boolean } = {},
): Promise<{ contracts: [MarketContract, MarketContract]; market: Market }> {
  const [contract] = await db
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.id, contractId))
    .limit(1);

  if (!contract) {
    throw new ExchangeMarketNotFoundError({ contractId });
  }

  return loadMarketByMarketId(db, contract.marketId, options);
}

async function getMarketView(
  config: ExchangeConfig,
  db: ExchangeExecutor,
  input:
    | {
        contractId: string;
        marketId?: never;
      }
    | {
        contractId?: never;
        marketId: string;
      },
): Promise<ExchangeMarketView> {
  const loaded =
    input.marketId !== undefined
      ? await loadMarketByMarketId(db, input.marketId)
      : await loadMarketByContractId(db, input.contractId);

  return toMarketView(config, loaded.market, loaded.contracts);
}

async function loadMarketByMarketId(
  db: ExchangeExecutor,
  marketId: string,
  options: { lock?: boolean } = {},
): Promise<{ contracts: [MarketContract, MarketContract]; market: Market }> {
  const marketQuery = db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .limit(1);
  const [market] = options.lock ? await marketQuery.for("update") : await marketQuery;

  if (!market) {
    throw new ExchangeMarketNotFoundError({ marketId });
  }

  const contractQuery = db
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.marketId, market.id))
    .orderBy(schema.contracts.outcome);
  const contracts = options.lock ? await contractQuery.for("update") : await contractQuery;

  return {
    contracts: attachBinaryContracts(market.id, contracts),
    market,
  };
}

function toMarketView(
  config: ExchangeConfig,
  market: Market,
  contracts: [MarketContract, MarketContract],
): ExchangeMarketView {
  return {
    ...market,
    contracts,
    prices: getPrices(toLmsrState(config, contracts)),
  };
}

function toLmsrState(
  config: ExchangeConfig,
  contracts: [MarketContract, MarketContract],
): LmsrMarketState {
  const yesContract = getContractByOutcome(contracts, "YES");
  const noContract = getContractByOutcome(contracts, "NO");

  return {
    liquidityParameterMicro: config.defaultLiquidityMicro,
    noSharesMicro: noContract.shareSupplyMicro,
    yesSharesMicro: yesContract.shareSupplyMicro,
  };
}

function assertAcceptsBets(market: Market, now: Date) {
  if (market.status !== "open" || !market.closesAt || now >= market.closesAt) {
    throw new MarketNotTradeableError({
      closesAt: market.closesAt,
      marketId: market.id,
      now,
      status: market.status,
    });
  }
}

function attachBinaryContracts(
  marketId: string,
  contracts: MarketContract[],
): [MarketContract, MarketContract] {
  const yesContract = contracts.find((contract) => contract.outcome === "YES");
  const noContract = contracts.find((contract) => contract.outcome === "NO");

  if (!yesContract || !noContract || contracts.length !== 2) {
    throw new Error(`Market ${marketId} does not have YES and NO contracts`);
  }

  return [yesContract, noContract];
}

function getContractByOutcome(
  contracts: [MarketContract, MarketContract],
  outcome: "NO" | "YES",
): MarketContract {
  const contract = contracts.find((candidate) => candidate.outcome === outcome);

  if (!contract) {
    throw new Error(`Missing ${outcome} contract`);
  }

  return contract;
}

async function findExistingTrade(
  tx: ExchangeExecutor,
  idempotencyKey: string,
): Promise<Trade | null> {
  const [trade] = await tx
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.idempotencyKey, idempotencyKey))
    .limit(1);

  return trade ?? null;
}

async function upsertPosition(
  tx: ExchangeExecutor,
  input: {
    contractId: string;
    sharesMicro: bigint;
    userId: string;
  },
): Promise<Position> {
  const [position] = await tx
    .insert(schema.positions)
    .values({
      contractId: input.contractId,
      id: createId(),
      quantityMicro: input.sharesMicro,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        quantityMicro: sql`${schema.positions.quantityMicro} + ${input.sharesMicro}`,
        updatedAt: new Date(),
      },
      target: [schema.positions.userId, schema.positions.contractId],
    })
    .returning();

  if (!position) {
    throw new Error("Failed to update position");
  }

  return position;
}

async function incrementContractSupply(
  tx: ExchangeExecutor,
  contractId: string,
  sharesMicro: bigint,
) {
  const [contract] = await tx
    .update(schema.contracts)
    .set({
      shareSupplyMicro: sql`${schema.contracts.shareSupplyMicro} + ${sharesMicro}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.contracts.id, contractId))
    .returning();

  if (!contract) {
    throw new Error("Failed to update contract supply");
  }
}

function ledgerIdempotencyKey(idempotencyKey: string): string {
  return `exchange-buy:${idempotencyKey}`;
}

function isSameBuyPayload(left: BuyPayload | undefined, right: BuyPayload): boolean {
  return (
    left?.contractId === right.contractId &&
    left.outcome === right.outcome &&
    left.spendMicro === right.spendMicro &&
    left.targetSharesMicro === right.targetSharesMicro &&
    left.userId === right.userId
  );
}

function normalizePositionLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 25;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }

  return Math.min(limit, 100);
}

function serializeQuote(quote: LmsrQuote): SerializedQuote {
  return {
    costMicro: quote.costMicro.toString(),
    outcome: quote.outcome,
    pricesAfter: quote.pricesAfter,
    pricesBefore: quote.pricesBefore,
    sharesMicro: quote.sharesMicro.toString(),
  };
}

function deserializeQuote(quote: SerializedQuote): LmsrQuote {
  return {
    costMicro: BigInt(quote.costMicro),
    outcome: quote.outcome,
    pricesAfter: quote.pricesAfter,
    pricesBefore: quote.pricesBefore,
    sharesMicro: BigInt(quote.sharesMicro),
  };
}

function asTradeMetadata(value: Record<string, unknown>): TradeMetadata {
  return value as TradeMetadata;
}

function failMissingQuote(): never {
  throw new Error("Existing exchange trade is missing quote metadata");
}
