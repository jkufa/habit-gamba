import { closeMarket, createBinaryMarket, openMarket } from "@habit-gamba/contracts";
import { createDbClient, createId, repToMicro, schema } from "@habit-gamba/db";
import { createExchange } from "@habit-gamba/exchange";
import { creditRep, getBalance } from "@habit-gamba/wallet";
import { and, eq, inArray, like, lte, or } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  autoCancelExpiredMarkets,
  autoVoidUnresolvedMarkets,
  cancelMarket,
  checkResolutionInvariant,
  previewCancelMarket,
  ResolutionDeadlinePassedError,
  ResolutionIdempotencyConflictError,
  resolveMarket,
} from "../../index";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../db/drizzle", import.meta.url).pathname;
const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });

maybeDescribe("resolution settlement", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 8 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("credits winners, closes positions, writes resolution once, and rejects changed outcome", async () => {
    const { creatorId, marketId, noBettorId, yesBettorId } =
      await createFundedOpenMarket("resolve");
    const yesBuy = await buy(marketId, yesBettorId, "YES", repToMicro(5n), "resolve-yes");

    await buy(marketId, noBettorId, "NO", repToMicro(3n), "resolve-no");

    const yesBefore = await getBalance({ db: client.db, userId: yesBettorId });
    const noBefore = await getBalance({ db: client.db, userId: noBettorId });
    const first = await resolveMarket({
      db: client.db,
      marketId,
      outcome: "YES",
      resolvedAt: new Date("2030-05-01T23:59:59.000Z"),
      resolvedByUserId: creatorId,
    });
    const second = await resolveMarket({
      db: client.db,
      marketId,
      outcome: "YES",
      resolvedByUserId: creatorId,
    });
    const yesAfter = await getBalance({ db: client.db, userId: yesBettorId });
    const noAfter = await getBalance({ db: client.db, userId: noBettorId });
    const contracts = await client.db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.marketId, marketId));
    const positions = await client.db
      .select()
      .from(schema.positions)
      .where(
        inArray(
          schema.positions.contractId,
          contracts.map((contract) => contract.id),
        ),
      );
    const report = await checkResolutionInvariant({
      db: client.db,
      scope: { kind: "all", marketIds: [marketId] },
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.resolution.id).toBe(first.resolution.id);
    expect(first.ledgerEntries).toHaveLength(1);
    await expectMarketEvent(marketId, "market.resolved");
    expect(yesAfter.availableAmountMicro - yesBefore.availableAmountMicro).toBe(
      yesBuy.position.quantityMicro,
    );
    expect(noAfter.availableAmountMicro).toBe(noBefore.availableAmountMicro);
    expect(contracts.every((contract) => contract.shareSupplyMicro === 0n)).toBe(true);
    expect(positions.every((position) => position.quantityMicro === 0n)).toBe(true);
    expect(report.ok).toBe(true);

    await expect(
      resolveMarket({
        db: client.db,
        marketId,
        outcome: "NO",
        resolvedByUserId: creatorId,
      }),
    ).rejects.toThrow(ResolutionIdempotencyConflictError);
  });

  it("refunds original spend, burns creator penalty, and rejects changed reason", async () => {
    const { creatorId, marketId, noBettorId, yesBettorId } = await createFundedOpenMarket("cancel");
    const yesBuy = await buy(marketId, yesBettorId, "YES", repToMicro(4n), "cancel-yes");
    const noBuy = await buy(marketId, noBettorId, "NO", repToMicro(2n), "cancel-no");
    const creatorBefore = await getBalance({ db: client.db, userId: creatorId });
    const yesBefore = await getBalance({ db: client.db, userId: yesBettorId });
    const noBefore = await getBalance({ db: client.db, userId: noBettorId });
    const refundTotal = -yesBuy.trade.cashDeltaMicro - noBuy.trade.cashDeltaMicro;
    const expectedPenalty = refundTotal / 10n;
    const first = await cancelMarket({
      cancelledAt: new Date("2030-06-01T00:00:03.000Z"),
      creatorPenaltyBps: 1000,
      db: client.db,
      marketId,
      reason: "test cancel",
    });
    const second = await cancelMarket({
      creatorPenaltyBps: 1000,
      db: client.db,
      marketId,
      reason: "test cancel",
    });
    const creatorAfter = await getBalance({ db: client.db, userId: creatorId });
    const yesAfter = await getBalance({ db: client.db, userId: yesBettorId });
    const noAfter = await getBalance({ db: client.db, userId: noBettorId });
    const report = await checkResolutionInvariant({
      db: client.db,
      scope: { kind: "all", marketIds: [marketId] },
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.cancellation.id).toBe(first.cancellation.id);
    expect(first.cancellation.refundTotalMicro).toBe(refundTotal);
    expect(first.cancellation.creatorPenaltyMicro).toBe(expectedPenalty);
    await expectMarketEvent(marketId, "market.voided");
    expect(yesAfter.availableAmountMicro - yesBefore.availableAmountMicro).toBe(
      -yesBuy.trade.cashDeltaMicro,
    );
    expect(noAfter.availableAmountMicro - noBefore.availableAmountMicro).toBe(
      -noBuy.trade.cashDeltaMicro,
    );
    expect(creatorAfter.availableAmountMicro - creatorBefore.availableAmountMicro).toBe(
      -expectedPenalty,
    );
    expect(report.ok).toBe(true);

    await expect(
      cancelMarket({
        db: client.db,
        marketId,
        reason: "different reason",
      }),
    ).rejects.toThrow(ResolutionIdempotencyConflictError);
  });

  it("previews cancellation refund, creator penalty, and creator net effect", async () => {
    const { marketId, noBettorId, yesBettorId } = await createFundedOpenMarket("preview");
    const yesBuy = await buy(marketId, yesBettorId, "YES", repToMicro(4n), "preview-yes");
    const noBuy = await buy(marketId, noBettorId, "NO", repToMicro(2n), "preview-no");
    const refundTotal = -yesBuy.trade.cashDeltaMicro - noBuy.trade.cashDeltaMicro;

    const preview = await previewCancelMarket({
      creatorPenaltyBps: 1000,
      db: client.db,
      marketId,
    });

    expect(preview.refundTotalMicro).toBe(refundTotal);
    expect(preview.creatorPenaltyMicro).toBe(refundTotal / 10n);
    expect(preview.creatorNetMicro).toBe(-(refundTotal / 10n));
  });

  it("rejects resolution after an open market deadline", async () => {
    const { creatorId, marketId } = await createFundedOpenMarket("late-resolution", {
      closesAt: new Date("2030-07-01T00:00:00.000Z"),
      openedAt: new Date("2030-06-01T00:00:00.000Z"),
    });

    await expect(
      resolveMarket({
        db: client.db,
        marketId,
        now: new Date("2030-07-01T00:00:00.000Z"),
        outcome: "YES",
        resolvedByUserId: creatorId,
      }),
    ).rejects.toThrow(ResolutionDeadlinePassedError);
  });

  it("auto-cancels expired open markets with a bounded limit", async () => {
    await client.db
      .update(schema.markets)
      .set({ closesAt: new Date("2100-01-01T00:00:00.000Z") })
      .where(
        and(
          eq(schema.markets.status, "open"),
          or(
            like(schema.markets.slug, "resolution-test-auto-%"),
            lte(schema.markets.closesAt, new Date("2029-07-02T00:00:00.000Z")),
          ),
        ),
      );

    const first = await createFundedOpenMarket("auto-first", {
      closesAt: new Date("2029-07-01T00:00:00.000Z"),
      openedAt: new Date("2029-06-01T00:00:00.000Z"),
    });
    const second = await createFundedOpenMarket("auto-second", {
      closesAt: new Date("2029-07-01T00:00:00.000Z"),
      openedAt: new Date("2029-06-01T00:00:00.000Z"),
    });
    const future = await createFundedOpenMarket("auto-future", {
      closesAt: new Date("2030-08-01T00:00:00.000Z"),
    });

    const result = await autoCancelExpiredMarkets({
      db: client.db,
      limit: 1,
      now: new Date("2029-07-02T00:00:00.000Z"),
      reason: "qa expired",
    });
    const markets = await client.db
      .select()
      .from(schema.markets)
      .where(inArray(schema.markets.id, [first.marketId, second.marketId, future.marketId]));
    const cancelled = markets.filter((market) => market.status === "void");
    const stillOpen = markets.filter((market) => market.status === "open");

    expect(result.cancelledCount).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.id === first.marketId || cancelled[0]?.id === second.marketId).toBe(true);
    expect(stillOpen.some((market) => market.id === future.marketId)).toBe(true);
  });

  it("auto-voids expired open and closed unresolved markets with a bounded limit", async () => {
    const expired = await createFundedOpenMarket("auto-void-expired", {
      closesAt: new Date("2030-09-01T00:00:00.000Z"),
      openedAt: new Date("2030-08-01T00:00:00.000Z"),
    });
    const closed = await createFundedOpenMarket("auto-void-closed", {
      closesAt: new Date("2030-10-01T00:00:00.000Z"),
      openedAt: new Date("2030-09-01T00:00:00.000Z"),
    });
    const future = await createFundedOpenMarket("auto-void-future", {
      closesAt: new Date("2030-11-01T00:00:00.000Z"),
      openedAt: new Date("2030-10-01T00:00:00.000Z"),
    });

    await closeMarket({ db: client.db, marketId: closed.marketId });

    const first = await autoVoidUnresolvedMarkets({
      db: client.db,
      limit: 1,
      marketIds: [expired.marketId, closed.marketId, future.marketId],
      now: new Date("2030-09-02T00:00:00.000Z"),
    });
    const second = await autoVoidUnresolvedMarkets({
      db: client.db,
      limit: 10,
      marketIds: [expired.marketId, closed.marketId, future.marketId],
      now: new Date("2030-09-02T00:00:00.000Z"),
    });
    const markets = await client.db
      .select()
      .from(schema.markets)
      .where(inArray(schema.markets.id, [expired.marketId, closed.marketId, future.marketId]));
    const voided = markets.filter((market) => market.status === "void");
    const futureMarket = markets.find((market) => market.id === future.marketId);

    expect(first.voidedCount).toBe(1);
    expect(second.errors).toHaveLength(0);
    expect(first.voidedCount + second.voidedCount).toBe(2);
    expect(voided.map((market) => market.id).sort()).toEqual(
      [expired.marketId, closed.marketId].sort(),
    );
    expect(futureMarket?.status).toBe("open");
  });

  async function createFundedOpenMarket(
    label: string,
    options: { closesAt?: Date; openedAt?: Date } = {},
  ): Promise<{
    creatorId: string;
    marketId: string;
    noBettorId: string;
    yesBettorId: string;
  }> {
    const creatorId = await createUser(`${label}-creator`);
    const yesBettorId = await createUser(`${label}-yes`);
    const noBettorId = await createUser(`${label}-no`);

    await Promise.all([
      fundUser(creatorId, repToMicro(100n), label),
      fundUser(yesBettorId, repToMicro(100n), label),
      fundUser(noBettorId, repToMicro(100n), label),
    ]);

    const { market } = await createBinaryMarket({
      creatorUserId: creatorId,
      db: client.db,
      slug: `resolution-test-${label}-${createId().toLowerCase()}`,
      title: `Resolution Test ${label}`,
    });

    const opened = await openMarket({
      closesAt: options.closesAt ?? new Date("2030-05-02T00:00:00.000Z"),
      db: client.db,
      marketId: market.id,
      openedAt: options.openedAt ?? new Date("2030-05-01T00:00:00.000Z"),
    });

    return {
      creatorId,
      marketId: opened.id,
      noBettorId,
      yesBettorId,
    };
  }

  async function buy(
    marketId: string,
    userId: string,
    outcome: "NO" | "YES",
    amountMicro: bigint,
    label: string,
  ) {
    const [contract] = await client.db
      .select()
      .from(schema.contracts)
      .where(and(eq(schema.contracts.marketId, marketId), eq(schema.contracts.outcome, outcome)))
      .limit(1);

    if (!contract) {
      throw new Error("Missing test contract");
    }

    return exchange.buy({
      amountMicro,
      contractId: contract.id,
      db: client.db,
      idempotencyKey: `resolution-test:${marketId}:${userId}:${label}`,
      now: new Date("2030-05-01T00:00:01.000Z"),
      outcome,
      userId,
    });
  }

  async function createUser(label: string): Promise<string> {
    const userId = createId();

    await client.db.insert(schema.users).values({
      displayName: `Resolution Test ${label}`,
      id: userId,
      provider: "resolution-test",
      providerUserId: `${label}-${userId}`,
    });

    return userId;
  }

  async function fundUser(userId: string, amountMicro: bigint, label: string) {
    await creditRep({
      amountMicro,
      db: client.db,
      idempotencyKey: `resolution-test:${userId}:fund:${label}`,
      sourceId: `resolution-test:${userId}:fund:${label}`,
      sourceType: "resolution_test_fund",
      userId,
    });
  }

  async function expectMarketEvent(marketId: string, type: string) {
    const [event] = await client.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.aggregateId, marketId), eq(schema.events.type, type)))
      .limit(1);

    expect(event).toBeTruthy();
    expect(event?.aggregateType).toBe("market");
  }
});
