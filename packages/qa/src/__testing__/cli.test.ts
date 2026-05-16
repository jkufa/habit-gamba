import { describe, expect, it, vi } from "vitest";

import { parseArgs, runCli } from "../cli";

describe("qa cli parsing", () => {
  it("parses stress seed and defaults run scope to qa", () => {
    expect(
      parseArgs(["run", "stress", "--seed", "123", "--trades", "500", "--trade-concurrency", "16"]),
    ).toMatchObject({
      command: "run",
      scenario: "stress",
      scope: "qa",
      seed: 123,
      tradeConcurrency: 16,
      trades: 500,
    });
  });

  it("requires a database before running trade stress", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runCli(["run", "stress", "--trades", "500"], {})).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("DATABASE_URL or --database-url is required");

    errorSpy.mockRestore();
  });

  it("requires destructive opt-in for isolated database setup", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      runCli(["setup", "--setup-isolated-db"], {
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
      }),
    ).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("--setup-isolated-db requires --allow-destructive");

    errorSpy.mockRestore();
  });
});
