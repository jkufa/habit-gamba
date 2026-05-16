import { describe, expect, it } from "vitest";

import { REP_CURRENCY, REP_SCALE, repToMicro } from "../src/currency";

describe("REP currency helpers", () => {
  it("preserves REP micro-unit constants", () => {
    expect(REP_CURRENCY).toBe("REP");
    expect(REP_SCALE).toBe(1_000_000n);
    expect(repToMicro(42n)).toBe(42_000_000n);
  });
});
