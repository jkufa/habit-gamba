import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";

import { canManageMarket, isGuildAdminPermission } from "../permissions";

describe("bot permissions", () => {
  it("allows market creator and guild admins", () => {
    expect(
      canManageMarket(
        { discordUserId: "discord-a", isGuildAdmin: false, userId: "user-a" },
        { creatorUserId: "user-a" },
      ),
    ).toBe(true);
    expect(
      canManageMarket(
        { discordUserId: "discord-b", isGuildAdmin: true, userId: "user-b" },
        { creatorUserId: "user-a" },
      ),
    ).toBe(true);
  });

  it("rejects unrelated non-admin users", () => {
    expect(
      canManageMarket(
        { discordUserId: "discord-b", isGuildAdmin: false, userId: "user-b" },
        { creatorUserId: "user-a" },
      ),
    ).toBe(false);
  });

  it("recognizes administrator and manage server permissions", () => {
    expect(isGuildAdminPermission(PermissionFlagsBits.Administrator)).toBe(true);
    expect(isGuildAdminPermission(PermissionFlagsBits.ManageGuild)).toBe(true);
    expect(isGuildAdminPermission(PermissionFlagsBits.SendMessages)).toBe(false);
  });
});
