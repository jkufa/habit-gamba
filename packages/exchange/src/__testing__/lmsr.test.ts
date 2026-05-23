import { repToMicro } from "@habit-gamba/db";
import { describe, expect, it } from "vitest";

import { applyBuy, getPrices, quoteBuy, quoteBuyShares } from "../lmsr";
import type { LmsrMarketState } from "../lmsr";

const initialState: LmsrMarketState = {
  liquidityParameterMicro: repToMicro(100n),
  noSharesMicro: 0n,
  yesSharesMicro: 0n,
};

describe("LMSR engine", () => {
  it("starts YES price at 0.5", () => {
    expect(getPrices(initialState).yes).toBe(0.5);
  });

  it("buy YES increases YES price", () => {
    const before = getPrices(initialState);
    const after = getPrices(applyBuy(initialState, "YES", repToMicro(10n)));

    expect(after.yes).toBeGreaterThan(before.yes);
  });

  it("buy NO decreases YES price", () => {
    const before = getPrices(initialState);
    const after = getPrices(applyBuy(initialState, "NO", repToMicro(10n)));

    expect(after.yes).toBeLessThan(before.yes);
  });

  it("keeps YES and NO prices approximately equal to 1", () => {
    const prices = getPrices(applyBuy(initialState, "YES", repToMicro(33n)));

    expect(prices.yes + prices.no).toBeCloseTo(1, 12);
  });

  it("larger buys move price more", () => {
    const small = getPrices(applyBuy(initialState, "YES", repToMicro(1n)));
    const large = getPrices(applyBuy(initialState, "YES", repToMicro(10n)));

    expect(large.yes - 0.5).toBeGreaterThan(small.yes - 0.5);
  });

  it("quote is deterministic", () => {
    const first = quoteBuy(initialState, "YES", repToMicro(10n));
    const second = quoteBuy(initialState, "YES", repToMicro(10n));

    expect(second).toEqual(first);
  });

  it("ceil quote cost never exceeds budget", () => {
    const budgetMicro = repToMicro(7n);
    const quote = quoteBuy(initialState, "YES", budgetMicro);

    expect(quote.costMicro).toBeLessThanOrEqual(budgetMicro);
    expect(quote.sharesMicro).toBeGreaterThan(0n);
  });

  it("spends safely when buying the cheap side of an imbalanced market", () => {
    const budgetMicro = repToMicro(1_000n);
    const imbalancedState: LmsrMarketState = {
      liquidityParameterMicro: repToMicro(100n),
      noSharesMicro: 0n,
      yesSharesMicro: repToMicro(5_000n),
    };
    const quote = quoteBuy(imbalancedState, "NO", budgetMicro);

    expect(quote.costMicro).toBeGreaterThan(0n);
    expect(quote.costMicro).toBeLessThanOrEqual(budgetMicro);
    expect(quote.sharesMicro).toBeGreaterThan(budgetMicro);
    expect(quote.pricesAfter.no).toBeGreaterThan(quote.pricesBefore.no);
  });

  it("quotes exact target shares", () => {
    const sharesMicro = repToMicro(3n);
    const quote = quoteBuyShares(initialState, "YES", sharesMicro);

    expect(quote.sharesMicro).toBe(sharesMicro);
    expect(quote.costMicro).toBeGreaterThan(0n);
    expect(quote.pricesAfter.yes).toBeGreaterThan(quote.pricesBefore.yes);
  });

  it("charges at least one micro for tiny positive target-share costs", () => {
    const imbalancedState: LmsrMarketState = {
      liquidityParameterMicro: repToMicro(100n),
      noSharesMicro: 0n,
      yesSharesMicro: repToMicro(5_000n),
    };
    const quote = quoteBuyShares(imbalancedState, "NO", repToMicro(1_000n));

    expect(quote.costMicro).toBeGreaterThan(0n);
  });
});
