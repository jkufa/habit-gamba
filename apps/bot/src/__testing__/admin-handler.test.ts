import type { ChatInputCommandInteraction } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleAdmin } from "../handlers/admin";
import type { BotHandlerContext } from "../handlers/context";

describe("admin handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unregistered target users before adjustment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: accountResponse("admin-user", "discord-admin") }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "UNAUTHORIZED",
              message: "Authenticated user was not found",
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 401,
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    await expect(handleAdmin(context(), interaction())).rejects.toThrow(
      "Target user must register first with `/account register`",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function context(): BotHandlerContext {
  return {
    client: {} as BotHandlerContext["client"],
    services: {
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
    },
  };
}

function interaction(): ChatInputCommandInteraction {
  return {
    options: {
      getSubcommandGroup: () => null,
      getString: (name: string) => (name === "amount" ? "1.25" : "audit reason"),
      getSubcommand: () => "credit",
      getUser: () => ({
        id: "discord-target",
        toString: () => "<@discord-target>",
      }),
    },
    reply: vi.fn(),
    user: {
      id: "discord-admin",
    },
  } as unknown as ChatInputCommandInteraction;
}

function accountResponse(userId: string, providerUserId: string) {
  return {
    balance: {
      availableAmountMicro: "0",
      creditLimitMicro: "0",
      currency: "REP",
      lockedAmountMicro: "0",
      userId,
    },
    positions: [],
    user: {
      createdAt: "2026-05-17T17:44:29.015Z",
      displayName: "Admin User",
      handle: "admin-user",
      id: userId,
      metadata: {},
      provider: "discord",
      providerUserId,
      status: "active",
      updatedAt: "2026-05-17T17:44:29.015Z",
    },
  };
}
