import { createId } from "@habit-gamba/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createBotApiTestProvider, type BotApiTestProvider } from "./test-provider";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../packages/db/drizzle", import.meta.url).pathname;

maybeDescribe("bot API test provider", () => {
  let provider: BotApiTestProvider;
  let closeProvider: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for bot API provider tests");
    }

    const context = await createBotApiTestProvider({
      databaseUrl,
      migrationsFolder,
    });

    provider = context.provider;
    closeProvider = context.close;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeProvider?.();
  });

  it("runs a multi-account market flow through bot service commands", async () => {
    const creator = await provider.account("creator");
    const yesTrader = await provider.account("yes-trader");
    const noTrader = await provider.account("no-trader");
    const marketTitle = `Will bot provider flow pass ${createId()}?`;
    const created = await provider.createMarket(creator.actor, {
      description: "Bot-owned API provider integration scenario",
      title: marketTitle,
    });

    const opened = await provider.openMarket(creator.actor, {
      closesAt: new Date("2099-01-01T00:00:00.000Z"),
      marketId: created.market.id,
    });
    const yesBuy = await provider.buy(yesTrader.actor, {
      marketId: created.market.id,
      outcome: "YES",
      value: "10",
    });
    const noBuy = await provider.buy(noTrader.actor, {
      marketId: created.market.id,
      outcome: "NO",
      value: "7",
    });

    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001");

    const firstReplayableBuy = await provider.buy(yesTrader.actor, {
      marketId: created.market.id,
      outcome: "YES",
      value: "5",
    });
    const secondReplayableBuy = await provider.buy(yesTrader.actor, {
      marketId: created.market.id,
      outcome: "YES",
      value: "5",
    });
    const yesPositions = await provider.positions(yesTrader.actor);
    const noPositions = await provider.positions(noTrader.actor);
    const finalMarket = await provider.viewMarket(created.market.id);
    const yesContract = finalMarket.contracts.find((contract) => contract.outcome === "YES");
    const noContract = finalMarket.contracts.find((contract) => contract.outcome === "NO");

    expect(creator.user.provider).toBe("discord");
    expect(creator.actor.userId).toBe(creator.user.id);
    expect(created.opened).toBe(false);
    expect(created.market.status).toBe("draft");
    expect(opened.status).toBe("open");
    expect(opened.closesAt).toBeInstanceOf(Date);
    expect(opened.title).toBe(marketTitle);

    expect(yesBuy.trade.userId).toBe(yesTrader.user.id);
    expect(yesBuy.position.userId).toBe(yesTrader.user.id);
    expect(yesBuy.quote.costMicro).toBeGreaterThan(0n);
    expect(yesBuy.quote.sharesMicro).toBeGreaterThan(0n);
    expect(yesBuy.market.prices?.yes).toBeGreaterThan(0.5);

    expect(noBuy.trade.userId).toBe(noTrader.user.id);
    expect(noBuy.position.userId).toBe(noTrader.user.id);
    expect(noBuy.quote.costMicro).toBeGreaterThan(0n);
    expect(noBuy.quote.sharesMicro).toBeGreaterThan(0n);

    expect(firstReplayableBuy.idempotent).toBe(false);
    expect(secondReplayableBuy.idempotent).toBe(true);
    expect(secondReplayableBuy.trade.id).toBe(firstReplayableBuy.trade.id);
    expect(secondReplayableBuy.position.quantityMicro).toBe(
      firstReplayableBuy.position.quantityMicro,
    );

    expect(yesPositions.positions.some((view) => view.market.id === created.market.id)).toBe(true);
    expect(noPositions.positions.some((view) => view.market.id === created.market.id)).toBe(true);
    expect(finalMarket.status).toBe("open");
    expect(finalMarket.prices).toMatchObject({
      no: expect.any(Number),
      yes: expect.any(Number),
    });
    expect(yesContract?.shareSupplyMicro).toBeGreaterThan(0n);
    expect(noContract?.shareSupplyMicro).toBeGreaterThan(0n);
  });
});
