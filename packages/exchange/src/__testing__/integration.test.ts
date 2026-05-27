import { closeMarket, createBinaryMarket, openMarket, voidMarket } from "@habit-gamba/contracts";
import { createDbClient, createId, repToMicro, schema } from "@habit-gamba/db";
import { creditRep, getBalance, InsufficientFundsError } from "@habit-gamba/wallet";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createExchange,
  ExchangeIdempotencyConflictError,
  ExchangeSelfTradeError,
  ExchangeTradeAmountTooSmallError,
  MarketNotTradeableError,
} from "../index";
import { checkExchangeReferenceInvariant } from "../invariants";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../db/drizzle", import.meta.url).pathname;
const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });

maybeDescribe("exchange buy flow", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 8 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("quotes without writing, then buy debits wallet and updates trade state", async () => {
    const userId = await createTestUser("quote-buy");
    const creatorId = await createTestUser("quote-buy-creator");
    const market = await createOpenMarket(creatorId, "quote-buy");
    const yesContract = market.contracts[0];

    await fundUser(userId, repToMicro(50n), "quote-buy");

    const beforeTrades = await client.db.select().from(schema.trades);
    const quote = await exchange.quoteBuy({
      amountMicro: repToMicro(10n),
      contractId: yesContract.id,
      db: client.db,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES",
    });
    const afterQuoteTrades = await client.db.select().from(schema.trades);

    expect(quote.costMicro).toBeLessThanOrEqual(repToMicro(10n));
    expect(afterQuoteTrades).toHaveLength(beforeTrades.length);

    const result = await exchange.buy({
      amountMicro: repToMicro(10n),
      contractId: yesContract.id,
      db: client.db,
      idempotencyKey: `exchange-test:${userId}:buy`,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES",
      userId,
    });
    const balance = await getBalance({ db: client.db, userId });
    const [updatedContract] = await client.db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.id, yesContract.id));

    expect(result.idempotent).toBe(false);
    expect(result.trade.cashDeltaMicro).toBe(-result.quote.costMicro);
    expect(result.position.quantityMicro).toBe(result.quote.sharesMicro);
    expect(updatedContract?.shareSupplyMicro).toBe(result.quote.sharesMicro);
    expect(balance.availableAmountMicro).toBe(repToMicro(50n) - result.quote.costMicro);
  });

  it("buys exact shares and lists open positions", async () => {
    const userId = await createTestUser("buy-shares");
    const creatorId = await createTestUser("buy-shares-creator");
    const market = await createOpenMarket(creatorId, "buy-shares");
    const yesContract = market.contracts[0];

    await fundUser(userId, repToMicro(50n), "buy-shares");

    const quote = await exchange.quoteBuyShares({
      contractId: yesContract.id,
      db: client.db,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES",
      sharesMicro: repToMicro(3n),
    });
    const result = await exchange.buyShares({
      contractId: yesContract.id,
      db: client.db,
      idempotencyKey: `exchange-test:${userId}:buy-shares`,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES",
      sharesMicro: repToMicro(3n),
      userId,
    });
    const positions = await exchange.listPositions({ db: client.db, userId });

    expect(result.quote.costMicro).toBe(quote.costMicro);
    expect(result.quote.sharesMicro).toBe(quote.sharesMicro);
    expect(result.position.quantityMicro).toBe(repToMicro(3n));
    expect(positions.positions).toHaveLength(1);
    expect(positions.positions[0]?.market.id).toBe(market.id);
    expect(positions.positions[0]?.contract.outcome).toBe("YES");
  });

  it("rejects sub-cent spend and share amounts", async () => {
    const userId = await createTestUser("tiny");
    const creatorId = await createTestUser("tiny-creator");
    const market = await createOpenMarket(creatorId, "tiny");
    const yesContract = market.contracts[0];

    await fundUser(userId, repToMicro(50n), "tiny");

    await expect(
      exchange.quoteBuy({
        amountMicro: 9_999n,
        contractId: yesContract.id,
        db: client.db,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
      }),
    ).rejects.toThrow(ExchangeTradeAmountTooSmallError);
    await expect(
      exchange.buyShares({
        contractId: yesContract.id,
        db: client.db,
        idempotencyKey: `exchange-test:${userId}:tiny`,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        sharesMicro: 9_999n,
        userId,
      }),
    ).rejects.toThrow(ExchangeTradeAmountTooSmallError);
  });

  it("rejects markets that do not accept bets", async () => {
    const userId = await createTestUser("closed");
    const creatorId = await createTestUser("closed-creator");
    const market = await createOpenMarket(creatorId, "closed");

    await closeMarket({
      closedAt: new Date("2030-01-02T00:00:00.000Z"),
      db: client.db,
      marketId: market.id,
    });

    await expect(
      exchange.buy({
        amountMicro: repToMicro(1n),
        contractId: market.contracts[0].id,
        db: client.db,
        idempotencyKey: `exchange-test:${userId}:closed`,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        userId,
      }),
    ).rejects.toThrow(MarketNotTradeableError);
  });

  it("rejects expired open markets", async () => {
    const creatorId = await createTestUser("expired-creator");
    const market = await createOpenMarket(creatorId, "expired");

    await expect(
      exchange.quoteBuy({
        amountMicro: repToMicro(1n),
        contractId: market.contracts[0].id,
        db: client.db,
        now: new Date("2030-01-02T00:00:00.000Z"),
        outcome: "YES",
      }),
    ).rejects.toThrow(MarketNotTradeableError);
  });

  it("rejects void markets", async () => {
    const userId = await createTestUser("void");
    const creatorId = await createTestUser("void-creator");
    const market = await createOpenMarket(creatorId, "void");

    await voidMarket({ db: client.db, marketId: market.id });

    await expect(
      exchange.buy({
        amountMicro: repToMicro(1n),
        contractId: market.contracts[0].id,
        db: client.db,
        idempotencyKey: `exchange-test:${userId}:void`,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        userId,
      }),
    ).rejects.toThrow(MarketNotTradeableError);
  });

  it("rolls back exchange writes when wallet debit fails", async () => {
    const userId = await createTestUser("insufficient");
    const creatorId = await createTestUser("insufficient-creator");
    const market = await createOpenMarket(creatorId, "insufficient");

    await expect(
      exchange.buy({
        amountMicro: repToMicro(100n),
        contractId: market.contracts[0].id,
        db: client.db,
        idempotencyKey: `exchange-test:${userId}:insufficient`,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        userId,
      }),
    ).rejects.toThrow(InsufficientFundsError);

    const trades = await client.db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.userId, userId));
    const positions = await client.db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.userId, userId));

    expect(trades).toHaveLength(0);
    expect(positions).toHaveLength(0);
  });

  it("returns existing result for duplicate identical idempotency key", async () => {
    const userId = await createTestUser("idempotent");
    const creatorId = await createTestUser("idempotent-creator");
    const market = await createOpenMarket(creatorId, "idempotent");
    const input = {
      amountMicro: repToMicro(5n),
      contractId: market.contracts[0].id,
      db: client.db,
      idempotencyKey: `exchange-test:${userId}:idempotent`,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES" as const,
      userId,
    };

    await fundUser(userId, repToMicro(50n), "idempotent");

    const first = await exchange.buy(input);
    const second = await exchange.buy(input);
    const balance = await getBalance({ db: client.db, userId });

    expect(second.idempotent).toBe(true);
    expect(second.trade.id).toBe(first.trade.id);
    expect(second.ledgerEntry.id).toBe(first.ledgerEntry.id);
    expect(balance.availableAmountMicro).toBe(repToMicro(50n) - first.quote.costMicro);
  });

  it("rejects duplicate idempotency key with changed payload", async () => {
    const userId = await createTestUser("conflict");
    const creatorId = await createTestUser("conflict-creator");
    const market = await createOpenMarket(creatorId, "conflict");
    const idempotencyKey = `exchange-test:${userId}:conflict`;

    await fundUser(userId, repToMicro(50n), "conflict");

    await exchange.buy({
      amountMicro: repToMicro(5n),
      contractId: market.contracts[0].id,
      db: client.db,
      idempotencyKey,
      now: new Date("2030-01-01T00:00:01.000Z"),
      outcome: "YES",
      userId,
    });

    await expect(
      exchange.buy({
        amountMicro: repToMicro(6n),
        contractId: market.contracts[0].id,
        db: client.db,
        idempotencyKey,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        userId,
      }),
    ).rejects.toThrow(ExchangeIdempotencyConflictError);
  });

  it("preserves exchange invariants across bounded concurrent buys", async () => {
    const userId = await createTestUser("concurrent");
    const creatorId = await createTestUser("concurrent-creator");
    const market = await createOpenMarket(creatorId, "concurrent");

    await fundUser(userId, repToMicro(1_000n), "concurrent");

    const outcomes = ["YES", "NO"] as const;
    await runBounded(
      Array.from({ length: 40 }, (_, index) => async () => {
        await exchange.buy({
          amountMicro: repToMicro(1n),
          contractId: market.contracts[0].id,
          db: client.db,
          idempotencyKey: `exchange-test:${userId}:concurrent:${index}`,
          now: new Date("2030-01-01T00:00:01.000Z"),
          outcome: outcomes[index % outcomes.length] ?? "YES",
          userId,
        });
      }),
      8,
    );

    const report = await checkExchangeReferenceInvariant({
      db: client.db,
      scope: { kind: "all", marketIds: [market.id], userIds: [userId] },
    });

    expect(report.ok).toBe(true);
  });

  it("rejects creator self-trades", async () => {
    const creatorId = await createTestUser("self-trade");
    const market = await createOpenMarket(creatorId, "self-trade");

    await fundUser(creatorId, repToMicro(50n), "self-trade");

    await expect(
      exchange.buy({
        amountMicro: repToMicro(1n),
        contractId: market.contracts[0].id,
        db: client.db,
        idempotencyKey: `exchange-test:${creatorId}:self-trade`,
        now: new Date("2030-01-01T00:00:01.000Z"),
        outcome: "YES",
        userId: creatorId,
      }),
    ).rejects.toThrow(ExchangeSelfTradeError);
  });

  async function createTestUser(label: string): Promise<string> {
    const userId = createId();

    await client.db.insert(schema.users).values({
      displayName: `Exchange Test ${label}`,
      id: userId,
      provider: "exchange-test",
      providerUserId: `${label}-${userId}`,
    });

    return userId;
  }

  async function createOpenMarket(creatorUserId: string, label: string) {
    const { market } = await createBinaryMarket({
      creatorUserId,
      db: client.db,
      slug: `exchange-test-${label}-${createId().toLowerCase()}`,
      title: `Exchange Test ${label}`,
    });

    return openMarket({
      closesAt: new Date("2030-01-02T00:00:00.000Z"),
      db: client.db,
      marketId: market.id,
      openedAt: new Date("2030-01-01T00:00:00.000Z"),
    });
  }

  async function fundUser(userId: string, amountMicro: bigint, label: string) {
    await creditRep({
      amountMicro,
      db: client.db,
      idempotencyKey: `exchange-test:${userId}:fund:${label}`,
      sourceId: `exchange-test:${userId}:fund:${label}`,
      sourceType: "exchange_test_fund",
      userId,
    });
  }
});

async function runBounded(tasks: Array<() => Promise<void>>, concurrency: number) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex];
        nextIndex += 1;
        await task?.();
      }
    }),
  );
}
