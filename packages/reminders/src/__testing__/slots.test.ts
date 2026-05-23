import { describe, expect, it } from "vitest";

import { marketReminderSlotsForCloseDate, normalizeMarketReminderBatchLimit } from "../index";

describe("market reminder slots", () => {
  it("creates 6pm and 10pm ET slots on an EDT close date", () => {
    const slots = marketReminderSlotsForCloseDate({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      now: new Date("2030-07-01T00:00:00.000Z"),
    });

    expect(slots).toEqual([
      { scheduledFor: new Date("2030-07-01T22:00:00.000Z"), slotKey: "eod_18_et" },
      { scheduledFor: new Date("2030-07-02T02:00:00.000Z"), slotKey: "eod_22_et" },
    ]);
  });

  it("creates 6pm and 10pm ET slots on an EST close date", () => {
    const slots = marketReminderSlotsForCloseDate({
      closesAt: new Date("2030-01-02T04:59:59.000Z"),
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(slots).toEqual([
      { scheduledFor: new Date("2030-01-01T23:00:00.000Z"), slotKey: "eod_18_et" },
      { scheduledFor: new Date("2030-01-02T03:00:00.000Z"), slotKey: "eod_22_et" },
    ]);
  });

  it("skips reminder slots already in the past", () => {
    const slots = marketReminderSlotsForCloseDate({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      now: new Date("2030-07-02T00:00:00.000Z"),
    });

    expect(slots).toEqual([
      { scheduledFor: new Date("2030-07-02T02:00:00.000Z"), slotKey: "eod_22_et" },
    ]);
  });

  it("normalizes batch limits", () => {
    expect(normalizeMarketReminderBatchLimit(undefined)).toBe(100);
    expect(normalizeMarketReminderBatchLimit(5)).toBe(5);
    expect(normalizeMarketReminderBatchLimit(10_000)).toBe(1_000);
    expect(() => normalizeMarketReminderBatchLimit(0)).toThrow(
      "MARKET_REMINDER_BATCH_LIMIT must be a positive integer",
    );
  });
});
