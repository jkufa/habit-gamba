import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { handleInteraction } from "../handlers";

describe("help handlers", () => {
  it("replies privately with default help", async () => {
    const reply = vi.fn();

    await handleInteraction({} as never, chatInput("help", null, reply));

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [expect.anything()],
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(reply.mock.calls[0]?.[0].embeds[0].toJSON().title).toBe("RepBet help");
  });

  it("replies privately with glossary term detail", async () => {
    const reply = vi.fn();

    await handleInteraction({} as never, chatInput("glossary", "rep", reply));

    expect(reply.mock.calls[0]?.[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
    expect(reply.mock.calls[0]?.[0].embeds[0].toJSON().title).toBe("REP");
  });

  it("filters admin autocomplete for non-admin users", async () => {
    const respond = vi.fn();

    await handleInteraction(
      {} as never,
      autocomplete("help", "topic", "admin", false, respond) as never,
    );

    expect(respond).toHaveBeenCalledWith([]);
  });

  it("shows admin autocomplete for administrators", async () => {
    const respond = vi.fn();

    await handleInteraction(
      {} as never,
      autocomplete("help", "topic", "admin", true, respond) as never,
    );

    expect(respond.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "admin" })]),
    );
  });
});

function chatInput(
  commandName: "glossary" | "help",
  value: string | null,
  reply: ReturnType<typeof vi.fn>,
) {
  return {
    commandName,
    isAutocomplete: () => false,
    isButton: () => false,
    isChatInputCommand: () => true,
    isModalSubmit: () => false,
    options: {
      getString: () => value,
    },
    reply,
  } as unknown as ChatInputCommandInteraction;
}

function autocomplete(
  commandName: string,
  focusedName: string,
  focusedValue: string,
  isAdmin: boolean,
  respond: ReturnType<typeof vi.fn>,
) {
  return {
    commandName,
    isAutocomplete: () => true,
    memberPermissions: {
      has: (permission: bigint) => isAdmin && permission === PermissionFlagsBits.Administrator,
    },
    options: {
      getFocused: () => ({ name: focusedName, value: focusedValue }),
    },
    respond,
  };
}
