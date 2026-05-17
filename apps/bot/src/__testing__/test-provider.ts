import { createDbClient, createId } from "@habit-gamba/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createApp } from "../../../server/src/app";
import type { Actor } from "../permissions";
import {
  buyMarketCommand,
  cancelMarketCommand,
  closeMarketCommand,
  createMarketCommand,
  getDiscordUser,
  listPositionsCommand,
  openMarketCommand,
  registerAccount,
  resolveMarketCommand,
  viewMarketCommand,
  type BotBalance,
  type BotMarket,
  type BotServices,
  type BotUser,
  type DiscordIdentity,
} from "../service";

const BOT_API_BASE_URL = "https://bot-api.test";
const BOT_API_TOKEN = "bot-api-test-token";

export type BotApiTestAccount = {
  actor: Actor;
  balance: BotBalance;
  identity: DiscordIdentity;
  user: BotUser;
};

export type BotApiTestProvider = ReturnType<typeof createProvider>;

export async function createBotApiTestProvider(input: {
  databaseUrl: string;
  migrationsFolder: string;
}) {
  const client = createDbClient({ databaseUrl: input.databaseUrl, max: 8 });

  await migrate(client.db, { migrationsFolder: input.migrationsFolder });

  const app = createApp({
    botApiToken: BOT_API_TOKEN,
    db: client.db,
    pingDb: async () => {
      await client.sql`select 1`;
    },
  });
  const services: BotServices = {
    apiBaseUrl: BOT_API_BASE_URL,
    botApiToken: BOT_API_TOKEN,
  };
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (requestInput, init) => {
    const url = requestUrl(requestInput);

    if (url.origin !== BOT_API_BASE_URL) {
      return originalFetch(requestInput, init);
    }

    return app.request(`${url.pathname}${url.search}`, init);
  }) as typeof fetch;

  return {
    provider: createProvider(services),
    services,
    async close() {
      globalThis.fetch = originalFetch;
      await client.sql.end();
    },
  };
}

function createProvider(services: BotServices) {
  return {
    account: (label: string) => createAccount(services, label),
    buy: (
      actor: Actor,
      input: {
        marketId: string;
        mode?: "spend_rep" | "target_shares";
        outcome: "NO" | "YES";
        value: string;
      },
    ) =>
      buyMarketCommand({
        ...services,
        actor,
        marketId: input.marketId,
        mode: input.mode ?? "spend_rep",
        outcome: input.outcome,
        value: input.value,
      }),
    cancelMarket: (actor: Actor, input: { marketId: string; reason: string }) =>
      cancelMarketCommand({
        ...services,
        actor,
        marketId: input.marketId,
        reason: input.reason,
      }),
    closeMarket: (actor: Actor, marketId: string) =>
      closeMarketCommand({
        ...services,
        actor,
        marketId,
      }),
    createMarket: (
      actor: Actor,
      input: {
        description?: string | null;
        slug?: string | null;
        title: string;
      },
    ) =>
      createMarketCommand({
        ...services,
        actor,
        description: input.description ?? null,
        slug: input.slug ?? null,
        title: input.title,
      }),
    openMarket: (actor: Actor, input: { closesAt: Date; marketId: string }) =>
      openMarketCommand({
        ...services,
        actor,
        closesAt: input.closesAt,
        marketId: input.marketId,
      }),
    positions: (actor: Actor) =>
      listPositionsCommand({
        ...services,
        actor,
      }),
    resolveMarket: (
      actor: Actor,
      input: { evidence?: Record<string, unknown>; marketId: string; outcome: "NO" | "YES" },
    ) =>
      resolveMarketCommand({
        ...services,
        actor,
        evidence: input.evidence ?? {},
        marketId: input.marketId,
        outcome: input.outcome,
      }),
    viewMarket: (marketId: string): Promise<BotMarket> =>
      viewMarketCommand({
        ...services,
        marketId,
      }),
  };
}

async function createAccount(services: BotServices, label: string): Promise<BotApiTestAccount> {
  const id = createId().toLowerCase();
  const identity: DiscordIdentity = {
    displayName: `Bot Test ${label}`,
    handle: `bot-${label}-${id}`,
    userId: `bot-test-${label}-${id}`,
  };

  const registration = await registerAccount({ ...services, identity });
  const user = await getDiscordUser({
    ...services,
    discordUserId: identity.userId,
  });

  if (!user) {
    throw new Error(`Failed to resolve test account ${identity.userId}`);
  }

  return {
    actor: {
      discordUserId: identity.userId,
      userId: user.id,
    },
    balance: registration.balance,
    identity,
    user,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input);
  }

  return new URL(input.url);
}
