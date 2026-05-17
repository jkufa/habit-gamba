import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_LIFECYCLE_BATCH_LIMIT,
  MAX_MARKET_LIFECYCLE_BATCH_LIMIT,
  normalizeMarketLifecycleBatchLimit,
} from "../service";

describe("market lifecycle worker service", () => {
  it("normalizes batch limits", () => {
    expect(normalizeMarketLifecycleBatchLimit(undefined)).toBe(
      DEFAULT_MARKET_LIFECYCLE_BATCH_LIMIT,
    );
    expect(normalizeMarketLifecycleBatchLimit(1)).toBe(1);
    expect(normalizeMarketLifecycleBatchLimit(10_000)).toBe(MAX_MARKET_LIFECYCLE_BATCH_LIMIT);
    expect(() => normalizeMarketLifecycleBatchLimit(0)).toThrow(RangeError);
  });
});
