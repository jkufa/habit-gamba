import type { Event } from "@habit-gamba/db";

export const MARKET_NOTIFICATION_EVENT_TYPES = ["market.resolved", "market.voided"] as const;

export type MarketNotificationEventType = (typeof MARKET_NOTIFICATION_EVENT_TYPES)[number];
export type MarketNotificationMarket = {
  closesAt: Date | null;
  description?: string | null;
  id: string;
  metadata: Record<string, unknown>;
  slug: string;
  status: string;
  title: string;
};
export type MarketNotificationIntent =
  | {
      content: string;
      eventType: "market.resolved";
      kind: "market_resolved";
      market: MarketNotificationMarket;
      outcome: "NO" | "YES";
      summaryTitle: "Market resolved";
    }
  | {
      content: string;
      eventType: "market.voided";
      kind: "market_voided";
      market: MarketNotificationMarket;
      reason: string | null;
      summaryTitle: "Market cancelled";
    };

export function composeMarketNotification(input: {
  event: Pick<Event, "payload" | "type">;
  market: MarketNotificationMarket | null;
}): MarketNotificationIntent | null {
  if (!input.market) {
    return null;
  }

  if (input.event.type === "market.resolved") {
    const outcome = readOutcome(input.event.payload);

    if (!outcome) {
      return null;
    }

    return {
      content: `Market resolved: ${outcome} won.`,
      eventType: "market.resolved",
      kind: "market_resolved",
      market: input.market,
      outcome,
      summaryTitle: "Market resolved",
    };
  }

  if (input.event.type === "market.voided") {
    const reason = readString(input.event.payload, "reason");

    return {
      content: reason ? `Market cancelled: ${reason}` : "Market cancelled.",
      eventType: "market.voided",
      kind: "market_voided",
      market: input.market,
      reason,
      summaryTitle: "Market cancelled",
    };
  }

  return null;
}

function readOutcome(payload: Record<string, unknown>): "NO" | "YES" | null {
  const outcome = payload.outcome;

  return outcome === "NO" || outcome === "YES" ? outcome : null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
