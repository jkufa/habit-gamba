import { describe, expect, it } from "vitest";

import { createLogger } from "@habit-gamba/logger";

describe("market lifecycle worker logger", () => {
  it("emits JSON logs with observability-compatible fields and top-level redaction", () => {
    const lines: string[] = [];
    const logger = createLogger({
      env: "test",
      service: "market-lifecycle-worker",
      write: (line) => lines.push(line),
    });

    logger.info("market_lifecycle_worker.run", {
      displayName: "Should Not Log",
      duration_ms: 12,
      handle: "hidden",
      outcome: "success",
      token: "secret",
      voided_count: 2,
      voided_market_ids: ["market_1", "market_2"],
    });

    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(parsed.level).toBe("info");
    expect(parsed.service).toBe("market-lifecycle-worker");
    expect(parsed.env).toBe("test");
    expect(parsed.event).toBe("market_lifecycle_worker.run");
    expect(parsed.outcome).toBe("success");
    expect(parsed.duration_ms).toBe(12);
    expect(parsed.voided_count).toBe(2);
    expect(parsed.token).toBeUndefined();
    expect(parsed.handle).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
    expect(typeof parsed.timestamp).toBe("string");
  });
});
