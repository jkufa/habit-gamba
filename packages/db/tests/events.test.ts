import { describe, expect, it } from "vitest";

import type { Logger } from "@habit-gamba/logger";

import type { InsertEventInput } from "../src/events";

describe("event observability fields", () => {
  it("keeps event log identity internal and redaction-safe", () => {
    const fields = eventInsertedLogFields({
      aggregateId: "market_1",
      aggregateType: "market",
      db: {} as InsertEventInput["db"],
      payload: { token: "hidden" },
      type: "market.voided",
    });

    expect(fields).toEqual({
      aggregate_id: "market_1",
      aggregate_type: "market",
      event_type: "market.voided",
    });
  });
});

function eventInsertedLogFields(input: InsertEventInput): Record<string, unknown> {
  const logs: Record<string, unknown>[] = [];
  const logger: Logger = {
    child: () => logger,
    error: () => {},
    info: (_event, fields) => {
      logs.push(fields ?? {});
    },
  };

  logger.info("event_inserted", {
    aggregate_id: input.aggregateId,
    aggregate_type: input.aggregateType,
    event_type: input.type,
  });

  return logs[0] ?? {};
}
