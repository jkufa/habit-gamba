import { getEventListeners } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sleep } from "../sleep";

describe("sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes the abort listener after the timer completes", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const sleeping = sleep(1_000, controller.signal);

      expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await sleeping;

      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    }
  });

  it("clears the timer and listener when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = sleep(60_000, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    controller.abort();
    await sleeping;

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles without retaining resources when already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    controller.abort();
    await sleep(60_000, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
