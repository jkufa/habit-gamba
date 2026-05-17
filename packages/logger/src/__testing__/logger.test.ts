import { describe, expect, it } from "vitest";

import { createLogger, createMetricsRegistry, createWideEvent } from "../index";

describe("logger", () => {
  it("emits redacted JSON with common fields and serializes bigint and errors", () => {
    const lines: string[] = [];
    const logger = createLogger({
      commitHash: "abc123",
      env: "test",
      service: "server",
      version: "1.0.0",
      write: (line) => lines.push(line),
    });

    logger.info("event_inserted", {
      displayName: "hidden",
      error: new Error("failed"),
      event_id: "evt_1",
      providerUserId: "hidden",
      token: "secret",
      value: 1n,
    });

    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(parsed).toMatchObject({
      commit_hash: "abc123",
      env: "test",
      event: "event_inserted",
      event_id: "evt_1",
      level: "info",
      service: "server",
      value: "1",
      version: "1.0.0",
    });
    expect(parsed.token).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
    expect(parsed.providerUserId).toBeUndefined();
    expect(parsed.error).toEqual({ message: "failed", name: "Error" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("filters info logs when level is error", () => {
    const lines: string[] = [];
    const logger = createLogger({
      env: "test",
      level: "error",
      service: "bot",
      write: (line) => lines.push(line),
    });

    logger.info("suppressed");
    logger.error("kept");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "kept", level: "error" });
  });

  it("finishes wide events once with duration and outcome", () => {
    const lines: string[] = [];
    const wideEvent = createWideEvent(
      createLogger({
        env: "test",
        service: "market-lifecycle-worker",
        write: (line) => lines.push(line),
      }),
      "market_lifecycle_worker.run",
      { run_id: "run_1" },
    );

    wideEvent.add({ voided_count: 2 });
    wideEvent.finish("success");
    wideEvent.error(new Error("late"));

    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(lines).toHaveLength(1);
    expect(parsed.outcome).toBe("success");
    expect(parsed.voided_count).toBe(2);
    expect(typeof parsed.duration_ms).toBe("number");
  });
});

describe("metrics", () => {
  it("renders counters and histograms in Prometheus text format", () => {
    const metrics = createMetricsRegistry();
    const counter = metrics.counter("habit_gamba_test_total", "Test counter");
    const histogram = metrics.histogram("habit_gamba_test_duration_ms", "Test duration", [10]);

    counter.add(1, { outcome: "success" });
    histogram.observe(7, { route: "/health" });

    expect(metrics.render()).toContain('habit_gamba_test_total{outcome="success"} 1');
    expect(metrics.render()).toContain(
      'habit_gamba_test_duration_ms_bucket{route="/health",le="10"} 1',
    );
  });
});
