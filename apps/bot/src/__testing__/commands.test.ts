import { describe, expect, it } from "vitest";

import { commandData } from "../commands";

type CommandOption = {
  default_member_permissions?: string;
  description?: string;
  name: string;
  options?: CommandOption[];
  required?: boolean;
  type?: number;
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

  it("registers help and glossary commands with autocomplete topic options", () => {
    const help = commandData.find((command) => command.name === "help") as
      | CommandOption
      | undefined;
    const glossary = commandData.find((command) => command.name === "glossary") as
      | CommandOption
      | undefined;

    expect(help?.options?.map((option) => option.name)).toEqual(["topic"]);
    expect(glossary?.options?.map((option) => option.name)).toEqual(["term"]);
    expect(help?.description).toContain("RepBet");
    expect(glossary?.description).toBe("Explain key market terms");
  });

  it("limits admin command discovery to Discord administrators", () => {
    const admin = commandData.find((command) => command.name === "admin") as
      | CommandOption
      | undefined;

    expect(admin?.default_member_permissions).toBe("8");
  });
});
