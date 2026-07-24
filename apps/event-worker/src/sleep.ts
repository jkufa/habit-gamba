export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", settle);
      resolve();
    };
    const timeout = setTimeout(settle, ms);

    signal?.addEventListener("abort", settle, { once: true });

    if (signal?.aborted) {
      settle();
    }
  });
}
