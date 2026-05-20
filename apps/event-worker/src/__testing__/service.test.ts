import { describe, expect, it } from "vitest";

import {
  EVENT_WORKER_MAX_ATTEMPTS,
  EVENT_WORKER_RETRY_DELAYS_MS,
  nextEventDeliveryAttemptAt,
} from "../service";

describe("event worker service", () => {
  it("uses short retry policy", () => {
    const now = new Date("2030-01-01T00:00:00.000Z");

    expect(EVENT_WORKER_MAX_ATTEMPTS).toBe(4);
    expect(nextEventDeliveryAttemptAt({ attempts: 0, now }).getTime()).toBe(
      now.getTime() + EVENT_WORKER_RETRY_DELAYS_MS[0],
    );
    expect(nextEventDeliveryAttemptAt({ attempts: 1, now }).getTime()).toBe(
      now.getTime() + EVENT_WORKER_RETRY_DELAYS_MS[1],
    );
    expect(nextEventDeliveryAttemptAt({ attempts: 2, now }).getTime()).toBe(
      now.getTime() + EVENT_WORKER_RETRY_DELAYS_MS[2],
    );
  });
});
