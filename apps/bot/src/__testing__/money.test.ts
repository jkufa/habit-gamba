import { repToMicro } from "@habit-gamba/db";
import { describe, expect, it } from "vitest";

import { formatMicro, parseDecimalMicro } from "../money";

describe("bot money formatting", () => {
  it("parses up to 2 decimals into micro units", () => {
    expect(parseDecimalMicro("1")).toBe(repToMicro(1n));
    expect(parseDecimalMicro("1.25")).toBe(1_250_000n);
    expect(parseDecimalMicro("0.01")).toBe(10_000n);
  });

  it("rejects invalid precision and zero", () => {
    expect(() => parseDecimalMicro("1.234")).toThrow();
    expect(() => parseDecimalMicro("0")).toThrow();
  });

  it("formats micro units with 2 decimals", () => {
    expect(formatMicro(1_250_000n)).toBe("1.25 REP");
    expect(formatMicro(-10_000n, "contracts")).toBe("-0.01 contracts");
  });
});
