import { formatMicro, formatPercent, parseDecimalMicro } from "./money";
import type { Actor } from "./permissions";

const DISCORD_PROVIDER = "discord";
const INITIAL_REFRESH_TRADE_LIMIT = 10;
const INCREMENTAL_REFRESH_TRADE_LIMIT = 25;

export type DiscordIdentity = {
  displayName: string;
  handle?: string | null;
  userId: string;
};

export type BotServices = {
  apiBaseUrl: string;
  botApiToken: string;
};

export type LastTradeRefresh = {
  createdAt: string;
  id: string;
};

export type MarketRefreshTrade = {
  buyerDisplayName: string;
  buyerHandle: string | null;
  cashDeltaMicro: bigint;
  createdAt: Date;
  id: string;
  outcome: "NO" | "YES";
  sharesDeltaMicro: bigint;
};

export type BotUser = {
  displayName: string;
  handle: string | null;
  id: string;
  metadata: Record<string, unknown>;
  provider: string;
  providerUserId: string;
  status: string;
};

export type BotBalance = {
  availableAmountMicro: bigint;
  creditLimitMicro: bigint;
  currency: string;
  lockedAmountMicro: bigint;
  userId: string;
};

export type BotMarket = {
  closesAt: Date | null;
  contracts: Array<{
    id: string;
    marketId: string;
    outcome: "NO" | "YES";
    shareSupplyMicro: bigint;
    title: string;
  }>;
  creatorUserId: string;
  description: string | null;
  id: string;
  metadata: Record<string, unknown>;
  prices?: { no: number; yes: number };
  slug: string;
  status: string;
  title: string;
};

export type BotPositionView = {
  contract: BotMarket["contracts"][number];
  market: BotMarket;
  position: {
    contractId: string;
    id: string;
    quantityMicro: bigint;
    userId: string;
  };
};

export type BotLeaderboardEntry = {
  balance: BotBalance;
  rank: number;
  user: BotUser;
};

export type BotApiErrorBody = {
  error?: {
    code: string;
    details?: unknown;
    message: string;
  };
};

export class BotApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "BotApiError";
  }
}

export async function getDiscordUser(input: BotServices & { discordUserId: string }) {
  const result = await request(input, "/accounts/me", {
    actor: { discordUserId: input.discordUserId },
    allowNotFound: true,
    method: "GET",
  });

  return result ? parseUser(result.user) : null;
}

export async function registerAccount(input: BotServices & { identity: DiscordIdentity }) {
  const result = await request(input, "/accounts/register", {
    body: {
      displayName: input.identity.displayName,
      handle: input.identity.handle ?? null,
      provider: DISCORD_PROVIDER,
      providerUserId: input.identity.userId,
    },
    method: "POST",
  });

  return {
    balance: parseBalance(result.balance),
    grant: result.grant,
    user: parseUser(result.user),
  };
}

export async function getAccount(input: BotServices & { actor: Actor }) {
  const result = await request(input, "/accounts/me", {
    actor: input.actor,
    method: "GET",
  });

  return {
    balance: parseBalance(result.balance),
    user: parseUser(result.user),
  };
}

export async function createMarketCommand(
  input: BotServices & {
    actor: Actor;
    description?: string | null;
    slug?: string | null;
    title: string;
  },
) {
  const result = await request(input, "/markets", {
    actor: input.actor,
    body: {
      description: input.description ?? null,
      ...(input.slug ? { slug: input.slug } : {}),
      title: input.title.trim(),
    },
    method: "POST",
  });

  return { market: parseMarket(result.market), opened: false };
}

export async function openMarketCommand(
  input: BotServices & {
    actor: Actor;
    closesAt: Date;
    marketId: string;
  },
) {
  const result = await request(input, `/markets/${input.marketId}/open`, {
    actor: input.actor,
    body: {
      closesAt: input.closesAt.toISOString(),
    },
    method: "POST",
  });

  return parseMarket(result);
}

export async function closeMarketCommand(input: BotServices & { actor: Actor; marketId: string }) {
  const result = await request(input, `/markets/${input.marketId}/close`, {
    actor: input.actor,
    method: "POST",
  });

  return parseMarket(result);
}

export async function refreshMarketCommand(
  input: BotServices & { actor: Actor; marketId: string },
) {
  return viewMarketCommand(input);
}

export async function viewMarketCommand(input: BotServices & { marketId: string }) {
  const result = await request(input, `/markets/${input.marketId}`, { method: "GET" });

  return parseMarket(result);
}

export async function buyMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    mode: "spend_rep" | "target_shares";
    outcome: "NO" | "YES";
    value: string;
  },
) {
  const amountMicro = parseDecimalMicro(input.value, input.mode);
  const result = await request(input, `/markets/${input.marketId}/buy`, {
    actor: input.actor,
    body: {
      amountMicro: amountMicro.toString(),
      mode: input.mode,
      outcome: input.outcome,
    },
    idempotencyKey: `discord:${input.actor.discordUserId}:buy:${crypto.randomUUID()}`,
    method: "POST",
  });

  return parseBuyResult(result);
}

export async function listPositionsCommand(
  input: BotServices & { actor: Actor },
): Promise<{ positions: BotPositionView[] }> {
  const result = await request(input, "/accounts/me/positions", {
    actor: input.actor,
    method: "GET",
  });

  return {
    positions: result.positions.map(parsePositionView),
  };
}

export async function getLeaderboardCommand(
  input: BotServices & { limit?: number },
): Promise<{ entries: BotLeaderboardEntry[] }> {
  const params = new URLSearchParams();

  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  const query = params.size > 0 ? `?${params}` : "";
  const result = await request(input, `/leaderboard${query}`, { method: "GET" });

  return {
    entries: result.entries.map(parseLeaderboardEntry),
  };
}

export async function resolveMarketCommand(
  input: BotServices & {
    actor: Actor;
    evidence: Record<string, unknown>;
    marketId: string;
    outcome: "NO" | "YES";
  },
) {
  const result = await request(input, `/markets/${input.marketId}/resolve`, {
    actor: input.actor,
    body: {
      evidence: input.evidence,
      outcome: input.outcome,
    },
    method: "POST",
  });

  return { ...result, market: parseMarket(result.market) };
}

export async function cancelMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    reason: string;
  },
) {
  const result = await request(input, `/markets/${input.marketId}/cancel`, {
    actor: input.actor,
    body: {
      reason: input.reason,
    },
    method: "POST",
  });

  return { ...result, market: parseMarket(result.market) };
}

export async function previewCancelMarketCommand(
  input: BotServices & { actor?: Actor; marketId: string },
) {
  return parseCancelPreview(
    await request(input, `/markets/${input.marketId}/cancel/preview`, {
      actor: input.actor,
      method: "POST",
    }),
  );
}

export async function autocompleteMarkets(
  input: BotServices & { actor?: Actor; query: string; subcommand?: string },
): Promise<BotMarket[]> {
  const params = new URLSearchParams({ query: input.query });

  if (input.subcommand) {
    params.set("subcommand", input.subcommand);
  }

  const result = await request(input, `/markets?${params}`, withOptionalActor(input.actor, "GET"));

  return result.markets.map(parseMarket);
}

export async function writeMarketDiscordMetadata(
  input: BotServices & {
    marketId: string;
    metadata: Record<string, unknown>;
  },
) {
  await request(input, `/markets/${input.marketId}/metadata`, {
    body: {
      metadata: {
        discord: input.metadata,
      },
    },
    method: "PATCH",
  });
}

export async function listMarketRefreshTrades(
  input: BotServices & {
    lastTradeRefresh?: LastTradeRefresh | null;
    marketId: string;
  },
): Promise<MarketRefreshTrade[]> {
  const params = new URLSearchParams();

  if (input.lastTradeRefresh) {
    params.set("createdAt", input.lastTradeRefresh.createdAt);
    params.set("id", input.lastTradeRefresh.id);
  }

  const query = params.size > 0 ? `?${params}` : "";
  const result = await request(input, `/markets/${input.marketId}/refresh-trades${query}`, {
    method: "GET",
  });

  return result.trades.map(parseRefreshTrade);
}

export function selectMarketRefreshTradesForPosting(
  trades: MarketRefreshTrade[],
  lastTradeRefresh?: LastTradeRefresh | null,
) {
  const cursor = parseTradeCursor(lastTradeRefresh);
  const limit = cursor ? INCREMENTAL_REFRESH_TRADE_LIMIT : INITIAL_REFRESH_TRADE_LIMIT;
  const sorted = [...trades].sort(compareTradesAscending);
  const candidates = cursor ? sorted.filter((trade) => isTradeAfterCursor(trade, cursor)) : sorted;

  return cursor ? candidates.slice(0, limit) : candidates.slice(-limit);
}

export function serializeLastTradeRefresh(
  trade: Pick<MarketRefreshTrade, "createdAt" | "id">,
): LastTradeRefresh {
  return {
    createdAt: trade.createdAt.toISOString(),
    id: trade.id,
  };
}

export function parseLastTradeRefresh(value: unknown): LastTradeRefresh | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.createdAt !== "string" || typeof record.id !== "string") {
    return null;
  }

  return { createdAt: record.createdAt, id: record.id };
}

export function marketSummaryFields(market: {
  closesAt: Date | null;
  prices?: { no: number; yes: number };
  slug: string;
  status: string;
}) {
  return [
    { name: "Slug", value: market.slug, inline: true },
    { name: "Status", value: market.status, inline: true },
    {
      name: "Closes",
      value: market.closesAt ? formatCloseDate(market.closesAt) : "not open",
      inline: true,
    },
    {
      name: "YES",
      value: market.prices ? formatPercent(market.prices.yes) : "50.0%",
      inline: true,
    },
    {
      name: "NO",
      value: market.prices ? formatPercent(market.prices.no) : "50.0%",
      inline: true,
    },
  ];
}

export function formatTradeSummary(input: {
  costMicro: bigint;
  outcome: string;
  sharesMicro: bigint;
  title: string;
}) {
  return `${input.outcome} ${formatMicro(input.sharesMicro, "contracts")} bought for ${formatMicro(input.costMicro)} on ${input.title}`;
}

export function formatMarketRefreshTradeSummary(input: {
  title: string;
  trade: MarketRefreshTrade;
}) {
  const buyer = input.trade.buyerHandle
    ? `${input.trade.buyerDisplayName} (@${input.trade.buyerHandle})`
    : input.trade.buyerDisplayName;
  const costMicro = -input.trade.cashDeltaMicro;

  return `${buyer} bought ${input.trade.outcome} ${formatMicro(input.trade.sharesDeltaMicro, "contracts")} for ${formatMicro(costMicro)} on ${input.title}`;
}

export function formatCloseDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(date);

  return `${formatted} ET`;
}

type TradeCursor = {
  createdAt: Date;
  id: string;
};

type RequestOptions = {
  actor?: Pick<Actor, "discordUserId"> | undefined;
  allowNotFound?: boolean;
  body?: unknown;
  idempotencyKey?: string;
  method: "GET" | "PATCH" | "POST";
};

async function request(input: BotServices, path: string, options: RequestOptions) {
  const response = await fetch(new URL(path, input.apiBaseUrl), {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: requestHeaders(input, options),
    method: options.method,
  });
  const payload = (await response.json()) as BotApiErrorBody & { data?: unknown };

  if (!response.ok) {
    if (options.allowNotFound && payload.error?.code === "UNAUTHORIZED") {
      return null;
    }

    throw new BotApiError(
      response.status,
      payload.error?.code ?? "API_ERROR",
      payload.error?.message ?? "API request failed",
      payload.error?.details,
    );
  }

  return payload.data as any;
}

function requestHeaders(input: BotServices, options: RequestOptions): Record<string, string> {
  return {
    Authorization: `Bearer ${input.botApiToken}`,
    "Content-Type": "application/json",
    ...(options.actor ? actorHeaders(options.actor) : {}),
    ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
  };
}

function actorHeaders(actor: Pick<Actor, "discordUserId">): Record<string, string> {
  return {
    "X-Provider": DISCORD_PROVIDER,
    "X-Provider-User-Id": actor.discordUserId,
  };
}

function withOptionalActor(
  actor: Actor | undefined,
  method: RequestOptions["method"],
): RequestOptions {
  return actor ? { actor, method } : { method };
}

function parseUser(value: any): BotUser {
  return value as BotUser;
}

function parseBalance(value: any): BotBalance {
  return {
    ...value,
    availableAmountMicro: BigInt(value.availableAmountMicro),
    creditLimitMicro: BigInt(value.creditLimitMicro),
    lockedAmountMicro: BigInt(value.lockedAmountMicro),
  };
}

function parseMarket(value: any): BotMarket {
  return {
    ...value,
    closesAt: value.closesAt ? new Date(value.closesAt) : null,
    contracts: value.contracts.map((contract: any) => ({
      ...contract,
      shareSupplyMicro: BigInt(contract.shareSupplyMicro),
    })),
  };
}

function parseBuyResult(value: any) {
  return {
    ...value,
    market: parseMarket(value.market),
    position: parsePosition(value.position),
    quote: parseQuote(value.quote),
  };
}

function parsePositionView(value: any) {
  return {
    contract: {
      ...value.contract,
      shareSupplyMicro: BigInt(value.contract.shareSupplyMicro),
    },
    market: parseMarket(value.market),
    position: parsePosition(value.position),
  };
}

function parseLeaderboardEntry(value: any): BotLeaderboardEntry {
  return {
    balance: parseBalance(value.balance),
    rank: value.rank,
    user: parseUser(value.user),
  };
}

function parsePosition(value: any) {
  return {
    ...value,
    quantityMicro: BigInt(value.quantityMicro),
  };
}

function parseQuote(value: any) {
  return {
    ...value,
    costMicro: BigInt(value.costMicro),
    sharesMicro: BigInt(value.sharesMicro),
  };
}

function parseCancelPreview(value: any) {
  return {
    creatorNetMicro: BigInt(value.creatorNetMicro),
    creatorPenaltyMicro: BigInt(value.creatorPenaltyMicro),
    refundTotalMicro: BigInt(value.refundTotalMicro),
  };
}

function parseRefreshTrade(value: any): MarketRefreshTrade {
  return {
    ...value,
    cashDeltaMicro: BigInt(value.cashDeltaMicro),
    createdAt: new Date(value.createdAt),
    sharesDeltaMicro: BigInt(value.sharesDeltaMicro),
  };
}

function parseTradeCursor(marker: LastTradeRefresh | null | undefined): TradeCursor | null {
  if (!marker) {
    return null;
  }

  const createdAt = new Date(marker.createdAt);

  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }

  return {
    createdAt,
    id: marker.id,
  };
}

function isTradeAfterCursor(
  trade: Pick<MarketRefreshTrade, "createdAt" | "id">,
  cursor: TradeCursor,
) {
  const createdAtDiff = trade.createdAt.getTime() - cursor.createdAt.getTime();

  return createdAtDiff > 0 || (createdAtDiff === 0 && trade.id > cursor.id);
}

function compareTradesAscending(
  left: Pick<MarketRefreshTrade, "createdAt" | "id">,
  right: Pick<MarketRefreshTrade, "createdAt" | "id">,
) {
  const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }

  return left.id.localeCompare(right.id);
}
