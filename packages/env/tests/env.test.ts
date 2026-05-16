import { describe, expect, it } from "vitest";

import { loadBaseEnv } from "../src/index";

describe("loadBaseEnv", () => {
  it("accepts valid local config", () => {
    expect(
      loadBaseEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
      LOG_LEVEL: "debug",
      NODE_ENV: "test",
    });
  });

  it("rejects missing database url", () => {
    expect(() => loadBaseEnv({})).toThrow();
    expect(() => loadBaseEnv({ NODE_ENV: "test" })).toThrow();
  });
});
