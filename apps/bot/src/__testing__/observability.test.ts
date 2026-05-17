import { createLogger } from "@habit-gamba/logger";
import { describe, expect, it } from "vitest";

import { createBotObservability, observeInteraction } from "../observability";

describe("bot observability", () => {
  it("emits interaction wide events without sensitive Discord fields", async () => {
    const lines: string[] = [];
    const observability = createBotObservability({
      env: "test",
      logger: createLogger({
        env: "test",
        service: "bot",
        write: (line) => lines.push(line),
      }),
    });

    await observeInteraction(observability, fakeCommandInteraction("market"), async () => {});

    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(parsed).toMatchObject({
      command: "market",
      event: "discord_interaction",
      interaction_kind: "chat_input_command",
      outcome: "success",
      service: "bot",
    });
    expect(parsed.providerUserId).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
    expect(parsed.message).toBeUndefined();
    expect(observability.metrics.render()).toContain("habit_gamba_discord_interactions_total");
  });
});

function fakeCommandInteraction(commandName: string) {
  return {
    commandName,
    isAutocomplete: () => false,
    isButton: () => false,
    isChatInputCommand: () => true,
    isModalSubmit: () => false,
  } as never;
}
