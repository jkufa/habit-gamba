import type {
  AccountAdjustmentResponse,
  AccountResponse,
  ApiErrorResponse,
  ApiOk,
  AutocompleteMarketsResponse,
  BuyMarketResponse,
  CancelMarketResponse,
  CloseMarketResponse,
  CreateRecurringMarketSeriesResponse,
  CreateMarketResponse,
  EndRecurringMarketSeriesResponse,
  LeaderboardResponse,
  MarketMetadataResponse,
  MarketResponse,
  OpenMarketResponse,
  PositionsResponse,
  PreviewCancelResponse,
  RefreshTradesResponse,
  RegisterAccountResponse,
  ResolveMarketResponse,
  Serialized,
  SellMarketResponse,
} from "@habit-gamba/api";
import type { Logger } from "@habit-gamba/logger";

import { formatMicro, formatPercent, parseDecimalMicro } from "./money";
import type { Actor } from "./permissions";

const DISCORD_PROVIDER = "discord";
const INITIAL_REFRESH_TRADE_LIMIT = 10;
const INCREMENTAL_REFRESH_TRADE_LIMIT = 25;

export type DiscordIdentity = {
  community: DiscordCommunity;
  displayName: string;
  handle?: string | null;
  isAdmin?: boolean;
  userId: string;
};

export type DiscordCommunity = {
  displayName: string;
  provider: typeof DISCORD_PROVIDER;
  providerCommunityId: string;
};

export type BotServices = {
  apiBaseUrl: string;
  botApiToken: string;
  logger?: Logger | undefined;
};

export type LastTradeRefresh = {
  createdAt: string;
  id: string;
};

export type MarketRefreshTrade = {
  actorDisplayName: string;
  actorHandle: string | null;
  cashDeltaMicro: bigint;
  createdAt: Date;
  id: string;
  outcome: "NO" | "YES";
  sharesDeltaMicro: bigint;
  side: "buy" | "sell";
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

type TradeActor = {
  displayName: string;
  handle: string | null;
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
  recurrenceDate: string | null;
  recurringSeriesId: string | null;
  slug: string;
  status: string;
  title: string;
};

export type BotRecurringMarketSeries = {
  creatorUserId: string;
  daysOfWeekMask: number;
  description: string | null;
  endedAt: Date | null;
  endReason: string | null;
  endsOn: string | null;
  id: string;
  metadata: Record<string, unknown>;
  nextOpenAt: Date | null;
  sourceMarketId: string;
  status: string;
  title: string;
};

export type BotCreateRecurringMarketSeriesResult = {
  firstMarket: BotMarket | null;
  series: BotRecurringMarketSeries;
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

export type BotPosition = BotPositionView["position"];

export type BotQuote = {
  costMicro: bigint;
  outcome: "NO" | "YES";
  pricesAfter: { no: number; yes: number };
  pricesBefore: { no: number; yes: number };
  sharesMicro: bigint;
};

export type BotLeaderboardEntry = {
  balance: BotBalance;
  rank: number;
  user: BotUser;
};

export type BotAccountAdjustmentResult = {
  balance: BotBalance;
  idempotent: boolean;
  ledgerEntry: Omit<
    Serialized<AccountAdjustmentResponse>["ledgerEntry"],
    "amountDeltaMicro" | "balanceAfterMicro"
  > & {
    amountDeltaMicro: bigint;
    balanceAfterMicro: bigint;
  };
  user: BotUser;
};

export type BotBuyResult = Omit<Serialized<BuyMarketResponse>, "market" | "position" | "quote"> & {
  market: BotMarket;
  position: BotPosition;
  quote: BotQuote;
};

export type BotSellResult = Omit<
  Serialized<SellMarketResponse>,
  "market" | "position" | "quote"
> & {
  market: BotMarket;
  position: BotPosition;
  quote: BotQuote;
};

export type BotResolvedMarketResult = Omit<Serialized<ResolveMarketResponse>, "market"> & {
  market: BotMarket;
};

export type BotCanceledMarketResult = Omit<Serialized<CancelMarketResponse>, "market"> & {
  market: BotMarket;
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

export async function getDiscordUser(
  input: BotServices & { community: DiscordCommunity; discordUserId: string },
) {
  const result = await request<AccountResponse>(input, "/accounts/me", {
    actor: { discordUserId: input.discordUserId },
    allowNotFound: true,
    community: input.community,
    method: "GET",
  });

  return result ? parseUser(result.user) : null;
}

export async function registerAccount(input: BotServices & { identity: DiscordIdentity }) {
  const result = await request<RegisterAccountResponse>(input, "/accounts/register", {
    body: {
      ...(input.identity.isAdmin === undefined ? {} : { admin: input.identity.isAdmin }),
      displayName: input.identity.displayName,
      handle: input.identity.handle ?? null,
      communityDisplayName: input.identity.community.displayName,
      communityProvider: input.identity.community.provider,
      provider: DISCORD_PROVIDER,
      providerCommunityId: input.identity.community.providerCommunityId,
      providerUserId: input.identity.userId,
    },
    community: input.identity.community,
    method: "POST",
  });

  return {
    balance: parseBalance(result.balance),
    grant: result.grant,
    user: parseUser(result.user),
  };
}

export async function getAccount(input: BotServices & { actor: Actor }) {
  const result = await request<AccountResponse>(input, "/accounts/me", {
    actor: input.actor,
    community: input.actor.community,
    method: "GET",
  });

  return {
    balance: parseBalance(result.balance),
    user: parseUser(result.user),
  };
}

export async function adjustUserBalanceCommand(
  input: BotServices & {
    actor: Actor;
    amountMicro: bigint;
    direction: "credit" | "debit";
    reason: string;
    targetUserId: string;
  },
): Promise<BotAccountAdjustmentResult> {
  const result = await request<AccountAdjustmentResponse>(
    input,
    `/accounts/${input.targetUserId}/adjustments`,
    {
      actor: input.actor,
      body: {
        amountMicro: input.amountMicro.toString(),
        direction: input.direction,
        reason: input.reason,
      },
      community: input.actor.community,
      idempotencyKey: `discord:${input.actor.discordUserId}:admin:${input.direction}:${crypto.randomUUID()}`,
      method: "POST",
    },
  );

  return parseAccountAdjustmentResult(result);
}

export async function createMarketCommand(
  input: BotServices & {
    actor: Actor;
    description?: string | null;
    slug?: string | null;
    title: string;
  },
): Promise<{ market: BotMarket; opened: false }> {
  const result = await request<CreateMarketResponse>(input, "/markets", {
    actor: input.actor,
    body: {
      description: input.description ?? null,
      ...(input.slug ? { slug: input.slug } : {}),
      title: input.title.trim(),
    },
    community: input.actor.community,
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
): Promise<BotMarket> {
  const result = await request<OpenMarketResponse>(input, `/markets/${input.marketId}/open`, {
    actor: input.actor,
    body: {
      closesAt: input.closesAt.toISOString(),
    },
    community: input.actor.community,
    method: "POST",
  });

  return parseMarket(result);
}

export async function createRecurringMarketSeriesCommand(
  input: BotServices & {
    actor: Actor;
    daysOfWeekMask: number;
    endsOn?: string | null;
    marketId: string;
    metadata: Record<string, unknown>;
  },
): Promise<BotCreateRecurringMarketSeriesResult> {
  const result = await request<CreateRecurringMarketSeriesResponse>(
    input,
    `/markets/${input.marketId}/recurring-series`,
    {
      actor: input.actor,
      body: {
        daysOfWeekMask: input.daysOfWeekMask,
        endsOn: input.endsOn ?? null,
        metadata: input.metadata,
      },
      community: input.actor.community,
      method: "POST",
    },
  );

  return {
    firstMarket: result.firstMarket ? parseMarket(result.firstMarket) : null,
    series: parseRecurringMarketSeries(result.series),
  };
}

export async function endRecurringMarketSeriesCommand(
  input: BotServices & {
    actor: Actor;
    reason?: string | null;
    seriesId: string;
  },
): Promise<{ series: BotRecurringMarketSeries }> {
  const result = await request<EndRecurringMarketSeriesResponse>(
    input,
    `/recurring-market-series/${input.seriesId}/end`,
    {
      actor: input.actor,
      body: {
        reason: input.reason ?? null,
      },
      community: input.actor.community,
      method: "POST",
    },
  );

  return { series: parseRecurringMarketSeries(result.series) };
}

export async function closeMarketCommand(
  input: BotServices & { actor: Actor; marketId: string },
): Promise<BotMarket> {
  const result = await request<CloseMarketResponse>(input, `/markets/${input.marketId}/close`, {
    actor: input.actor,
    community: input.actor.community,
    method: "POST",
  });

  return parseMarket(result);
}

export async function refreshMarketCommand(
  input: BotServices & { actor: Actor; marketId: string },
) {
  return viewMarketCommand(input);
}

export async function viewMarketCommand(
  input: BotServices & { actor?: Actor; community?: DiscordCommunity; marketId: string },
): Promise<BotMarket> {
  const result = await request<MarketResponse>(input, `/markets/${input.marketId}`, {
    community: requireRequestCommunity(input),
    method: "GET",
  });

  return parseMarket(result);
}

export async function findMarketByDiscordThread(
  input: BotServices & { community: DiscordCommunity; threadId: string },
): Promise<BotMarket | null> {
  const threadId = encodeURIComponent(input.threadId);

  try {
    const result = await request<MarketResponse>(input, `/markets/by-discord-thread/${threadId}`, {
      community: input.community,
      method: "GET",
    });

    return parseMarket(result);
  } catch (error) {
    if (error instanceof BotApiError && error.status === 404 && error.code === "MARKET_NOT_FOUND") {
      return null;
    }

    throw error;
  }
}

export async function buyMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    mode: "buy_shares" | "spend_rep";
    outcome: "NO" | "YES";
    value: string;
  },
): Promise<BotBuyResult> {
  const amountMicro = parseDecimalMicro(input.value, input.mode);
  const result = await request<BuyMarketResponse>(input, `/markets/${input.marketId}/buy`, {
    actor: input.actor,
    body: {
      amountMicro: amountMicro.toString(),
      mode: input.mode,
      outcome: input.outcome,
    },
    community: input.actor.community,
    idempotencyKey: `discord:${input.actor.discordUserId}:buy:${crypto.randomUUID()}`,
    method: "POST",
  });

  return parseBuyResult(result);
}

export async function sellMarketCommand(
  input: BotServices & {
    actor: Actor;
    marketId: string;
    mode: "sell_shares" | "target_rep";
    outcome: "NO" | "YES";
    value: string;
  },
): Promise<BotSellResult> {
  const amountMicro = parseDecimalMicro(input.value, input.mode);
  const result = await request<SellMarketResponse>(input, `/markets/${input.marketId}/sell`, {
    actor: input.actor,
    body: {
      amountMicro: amountMicro.toString(),
      mode: input.mode,
      outcome: input.outcome,
    },
    community: input.actor.community,
    idempotencyKey: `discord:${input.actor.discordUserId}:sell:${crypto.randomUUID()}`,
    method: "POST",
  });

  return parseSellResult(result);
}

export async function listPositionsCommand(
  input: BotServices & { actor: Actor },
): Promise<{ positions: BotPositionView[] }> {
  const result = await request<PositionsResponse>(input, "/accounts/me/positions", {
    actor: input.actor,
    community: input.actor.community,
    method: "GET",
  });

  return {
    positions: result.positions.map(parsePositionView),
  };
}

export async function getLeaderboardCommand(
  input: BotServices & { community: DiscordCommunity; limit?: number },
): Promise<{ entries: BotLeaderboardEntry[] }> {
  const params = new URLSearchParams();

  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  const query = params.size > 0 ? `?${params}` : "";
  const result = await request<LeaderboardResponse>(input, `/leaderboard${query}`, {
    community: input.community,
    method: "GET",
  });

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
): Promise<BotResolvedMarketResult> {
  const result = await request<ResolveMarketResponse>(input, `/markets/${input.marketId}/resolve`, {
    actor: input.actor,
    body: {
      evidence: input.evidence,
      outcome: input.outcome,
    },
    community: input.actor.community,
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
): Promise<BotCanceledMarketResult> {
  const result = await request<CancelMarketResponse>(input, `/markets/${input.marketId}/cancel`, {
    actor: input.actor,
    body: {
      reason: input.reason,
    },
    community: input.actor.community,
    method: "POST",
  });

  return { ...result, market: parseMarket(result.market) };
}

export async function previewCancelMarketCommand(
  input: BotServices & { actor?: Actor; marketId: string },
) {
  return parseCancelPreview(
    await request<PreviewCancelResponse>(input, `/markets/${input.marketId}/cancel/preview`, {
      actor: input.actor,
      community: input.actor?.community,
      method: "POST",
    }),
  );
}

export async function autocompleteMarkets(
  input: BotServices & {
    actor?: Actor;
    community: DiscordCommunity;
    query: string;
    subcommand?: string;
  },
): Promise<BotMarket[]> {
  const params = new URLSearchParams({ query: input.query });

  if (input.subcommand) {
    params.set("subcommand", input.subcommand);
  }

  const result = await request<AutocompleteMarketsResponse>(
    input,
    `/markets?${params}`,
    withOptionalActor(input.actor, "GET", input.community),
  );

  return result.markets.map(parseMarket);
}

export async function writeMarketDiscordMetadata(
  input: BotServices & {
    community: DiscordCommunity;
    marketId: string;
    metadata: Record<string, unknown>;
  },
) {
  await request<MarketMetadataResponse>(input, `/markets/${input.marketId}/metadata`, {
    body: {
      metadata: {
        discord: input.metadata,
      },
    },
    community: input.community,
    method: "PATCH",
  });
}

export async function listMarketRefreshTrades(
  input: BotServices & {
    actor: Actor;
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
  const result = await request<RefreshTradesResponse>(
    input,
    `/markets/${input.marketId}/refresh-trades${query}`,
    withOptionalActor(input.actor, "GET", input.actor.community),
  );

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

export function formatPublicTradeSummary(input: {
  costMicro: bigint;
  outcome: string;
  sharesMicro: bigint;
  user: TradeActor;
}) {
  return `${formatTradeActor(input.user)} bought ${formatMicro(input.sharesMicro, `${input.outcome} shares`)} @ ${formatMicro(averageSharePriceMicro(input))}`;
}

export function formatPrivateTradeSummary(input: {
  costMicro: bigint;
  outcome: string;
  sharesMicro: bigint;
}) {
  return `You bought ${formatMicro(input.sharesMicro, `${input.outcome} shares`)} @ ${formatMicro(averageSharePriceMicro(input))} for ${formatMicro(input.costMicro)}.`;
}

export function formatMarketRefreshTradeSummary(input: { trade: MarketRefreshTrade }) {
  if (input.trade.side === "sell") {
    return formatPublicSellSummary({
      outcome: input.trade.outcome,
      payoutMicro: input.trade.cashDeltaMicro,
      sharesMicro: -input.trade.sharesDeltaMicro,
      user: {
        displayName: input.trade.actorDisplayName,
        handle: input.trade.actorHandle,
      },
    });
  }

  return formatPublicTradeSummary({
    costMicro: -input.trade.cashDeltaMicro,
    outcome: input.trade.outcome,
    sharesMicro: input.trade.sharesDeltaMicro,
    user: {
      displayName: input.trade.actorDisplayName,
      handle: input.trade.actorHandle,
    },
  });
}

export function formatPublicSellSummary(input: {
  outcome: string;
  payoutMicro: bigint;
  sharesMicro: bigint;
  user: TradeActor;
}) {
  return `${formatTradeActor(input.user)} sold ${formatMicro(input.sharesMicro, `${input.outcome} shares`)} @ ${formatMicro(averageSharePriceMicro({ costMicro: input.payoutMicro, sharesMicro: input.sharesMicro }))}`;
}

export function formatPrivateSellSummary(input: {
  outcome: string;
  payoutMicro: bigint;
  sharesMicro: bigint;
}) {
  return `You sold ${formatMicro(input.sharesMicro, `${input.outcome} shares`)} @ ${formatMicro(averageSharePriceMicro({ costMicro: input.payoutMicro, sharesMicro: input.sharesMicro }))} and received ${formatMicro(input.payoutMicro)}.`;
}

function formatTradeActor(actor: TradeActor) {
  return actor.handle ? `${actor.displayName} (@${actor.handle})` : actor.displayName;
}

function averageSharePriceMicro(input: { costMicro: bigint; sharesMicro: bigint }) {
  if (input.sharesMicro <= 0n) {
    throw new RangeError("sharesMicro must be positive");
  }

  return (input.costMicro * 1_000_000n + input.sharesMicro / 2n) / input.sharesMicro;
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
  community?: DiscordCommunity | undefined;
  idempotencyKey?: string;
  method: "GET" | "PATCH" | "POST";
};

async function request<T>(
  input: BotServices,
  path: string,
  options: RequestOptions & { allowNotFound: true },
): Promise<Serialized<T> | null>;
async function request<T>(
  input: BotServices,
  path: string,
  options: RequestOptions,
): Promise<Serialized<T>>;
async function request<T>(
  input: BotServices,
  path: string,
  options: RequestOptions,
): Promise<Serialized<T> | null> {
  const response = await fetch(new URL(path, input.apiBaseUrl), {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: requestHeaders(input, options),
    method: options.method,
  });
  const payload = (await response.json()) as Partial<ApiErrorResponse> & Partial<ApiOk<T>>;

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

  return payload.data as Serialized<T>;
}

function requestHeaders(input: BotServices, options: RequestOptions): Record<string, string> {
  return {
    Authorization: `Bearer ${input.botApiToken}`,
    "Content-Type": "application/json",
    ...(options.actor ? actorHeaders(options.actor) : {}),
    ...(options.community ? communityHeaders(options.community) : {}),
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
  community: DiscordCommunity,
): RequestOptions {
  return actor ? { actor, community: actor.community, method } : { community, method };
}

function communityHeaders(community: DiscordCommunity): Record<string, string> {
  return {
    "X-Community-Provider": community.provider,
    "X-Provider-Community-Id": community.providerCommunityId,
  };
}

function requireRequestCommunity(input: { actor?: Actor; community?: DiscordCommunity }) {
  const community = input.community ?? input.actor?.community;

  if (!community) {
    throw new Error("Community context is required");
  }

  return community;
}

function parseUser(value: Serialized<AccountResponse["user"]>): BotUser {
  return value as BotUser;
}

function parseBalance(value: Serialized<BotBalance>): BotBalance {
  return {
    ...value,
    availableAmountMicro: BigInt(value.availableAmountMicro),
    creditLimitMicro: BigInt(value.creditLimitMicro),
    lockedAmountMicro: BigInt(value.lockedAmountMicro),
  };
}

function parseMarket(
  value: Serialized<CloseMarketResponse | MarketResponse | OpenMarketResponse>,
): BotMarket {
  return {
    ...value,
    closesAt: value.closesAt ? new Date(value.closesAt) : null,
    contracts: value.contracts.map((contract) => ({
      ...contract,
      shareSupplyMicro: BigInt(contract.shareSupplyMicro),
    })),
  };
}

function parseRecurringMarketSeries(
  value: Serialized<CreateRecurringMarketSeriesResponse["series"]>,
): BotRecurringMarketSeries {
  return {
    ...value,
    endedAt: value.endedAt ? new Date(value.endedAt) : null,
    nextOpenAt: value.nextOpenAt ? new Date(value.nextOpenAt) : null,
  };
}

function parseBuyResult(value: Serialized<BuyMarketResponse>): BotBuyResult {
  return {
    ...value,
    market: parseMarket(value.market),
    position: parsePosition(value.position),
    quote: parseQuote(value.quote),
  };
}

function parseSellResult(value: Serialized<SellMarketResponse>): BotSellResult {
  return {
    ...value,
    market: parseMarket(value.market),
    position: parsePosition(value.position),
    quote: parseQuote(value.quote),
  };
}

function parsePositionView(
  value: Serialized<PositionsResponse["positions"][number]>,
): BotPositionView {
  return {
    contract: {
      ...value.contract,
      shareSupplyMicro: BigInt(value.contract.shareSupplyMicro),
    },
    market: parseMarket(value.market),
    position: parsePosition(value.position),
  };
}

function parseLeaderboardEntry(
  value: Serialized<LeaderboardResponse["entries"][number]>,
): BotLeaderboardEntry {
  return {
    balance: parseBalance(value.balance),
    rank: value.rank,
    user: parseUser(value.user),
  };
}

function parseAccountAdjustmentResult(
  value: Serialized<AccountAdjustmentResponse>,
): BotAccountAdjustmentResult {
  return {
    balance: parseBalance(value.balance),
    idempotent: value.idempotent,
    ledgerEntry: {
      ...value.ledgerEntry,
      amountDeltaMicro: BigInt(value.ledgerEntry.amountDeltaMicro),
      balanceAfterMicro: BigInt(value.ledgerEntry.balanceAfterMicro),
    },
    user: parseUser(value.user),
  };
}

function parsePosition(
  value: Serialized<
    | BuyMarketResponse["position"]
    | PositionsResponse["positions"][number]["position"]
    | SellMarketResponse["position"]
  >,
): BotPosition {
  return {
    ...value,
    quantityMicro: BigInt(value.quantityMicro),
  };
}

function parseQuote(
  value: Serialized<BuyMarketResponse["quote"] | SellMarketResponse["quote"]>,
): BotQuote {
  return {
    ...value,
    costMicro: BigInt(value.costMicro),
    sharesMicro: BigInt(value.sharesMicro),
  };
}

function parseCancelPreview(value: Serialized<PreviewCancelResponse>): PreviewCancelResponse {
  return {
    creatorNetMicro: BigInt(value.creatorNetMicro),
    creatorPenaltyMicro: BigInt(value.creatorPenaltyMicro),
    refundTotalMicro: BigInt(value.refundTotalMicro),
  };
}

function parseRefreshTrade(
  value: Serialized<RefreshTradesResponse["trades"][number]>,
): MarketRefreshTrade {
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
