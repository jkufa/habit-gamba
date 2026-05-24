import { describe, expect, it } from "vitest";

import { commandData } from "../commands";

type CommandOption = {
  name: string;
  options?: CommandOption[];
  required?: boolean;
};

describe("bot commands", () => {
  it("registers admin credit, debit, and market close commands", () => {
    const admin = commandData.find((command) => command.name === "admin") as
      | CommandOption
      | undefined;
    const subcommands = admin?.options ?? [];
    const credit = subcommands.find((command) => command.name === "credit");
    const debit = subcommands.find((command) => command.name === "debit");
    const market = subcommands.find((command) => command.name === "market");
    const marketClose = market?.options?.find((command) => command.name === "close");

    expect(admin).toBeDefined();
    expect(credit?.options?.map((option) => option.name)).toEqual(["user", "amount", "reason"]);
    expect(debit?.options?.map((option) => option.name)).toEqual(["user", "amount", "reason"]);
    expect(credit?.options?.every((option) => option.required)).toBe(true);
    expect(debit?.options?.every((option) => option.required)).toBe(true);
    expect(marketClose?.options?.map((option) => option.name)).toEqual(["market"]);
    expect(marketClose?.options?.every((option) => option.required)).toBe(true);
  });

  it("registers recurring flag on market open", () => {
    const market = commandData.find((command) => command.name === "market") as
      | CommandOption
      | undefined;
    const open = market?.options?.find((command) => command.name === "open");

    expect(market?.options?.some((command) => command.name === "close")).toBe(false);
    expect(open?.options?.map((option) => option.name)).toEqual([
      "market",
      "closes_at",
      "recurring",
    ]);
  });
});
