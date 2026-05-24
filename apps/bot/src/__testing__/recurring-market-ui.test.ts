import { ButtonStyle } from "discord.js";
import { describe, expect, it } from "vitest";

import { recurringMarketHandlerTestUtils } from "../handlers/market";

type ButtonJson = {
  label?: string;
  style?: number;
};

function buttonStylesByLabel(mask: number, selectedPreset: "daily" | "weekdays" | "weekly" | null) {
  const rows = recurringMarketHandlerTestUtils.recurringScheduleRows(
    {
      actorUserId: "actor",
      marketId: "market",
      mask,
      selectedPreset,
    },
    1 << 6,
  );
  const buttons = rows.flatMap((row) => row.toJSON().components as ButtonJson[]);

  return new Map(buttons.map((button) => [button.label, button.style]));
}

describe("recurring market schedule UI", () => {
  it("does not mark weekly selected when Saturday is selected manually", () => {
    const styles = buttonStylesByLabel(1 << 6, null);

    expect(styles.get("Sat")).toBe(ButtonStyle.Primary);
    expect(styles.get("Weekly")).toBe(ButtonStyle.Secondary);
  });

  it("marks weekly selected when the weekly preset is selected", () => {
    const styles = buttonStylesByLabel(1 << 6, "weekly");

    expect(styles.get("Sat")).toBe(ButtonStyle.Primary);
    expect(styles.get("Weekly")).toBe(ButtonStyle.Primary);
  });
});
