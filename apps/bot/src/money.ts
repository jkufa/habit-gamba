import { REP_SCALE } from "@habit-gamba/db";

export function parseDecimalMicro(input: string, label = "amount"): bigint {
  const trimmed = input.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);

  if (!match) {
    throw new RangeError(`${label} must be a positive number with up to 2 decimals`);
  }

  const whole = BigInt(match[1] ?? "0");
  const cents = BigInt((match[2] ?? "").padEnd(2, "0"));
  const micro = whole * REP_SCALE + cents * (REP_SCALE / 100n);

  if (micro <= 0n) {
    throw new RangeError(`${label} must be positive`);
  }

  return micro;
}

export function formatMicro(value: bigint, unit = "REP"): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / REP_SCALE;
  const cents = (absolute % REP_SCALE) / (REP_SCALE / 100n);

  return `${sign}${whole}.${cents.toString().padStart(2, "0")} ${unit}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
