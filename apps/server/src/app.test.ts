import type {
  AccountAdjustmentResponse,
  AccountResponse,
  ApiErrorResponse,
  ApiOk,
  BuyMarketResponse,
  CancelMarketResponse,
  CloseMarketResponse,
  CreateMarketResponse,
  HealthResponse,
  LeaderboardResponse,
  MarketResponse,
  OpenMarketResponse,
  QuoteMarketResponse,
  ResolveMarketResponse,
  Serialized,
  SellMarketResponse,
} from "@habit-gamba/api";
import {
  DEFAULT_COMMUNITY_ID,
  createDbClient,
  createId,
  repToMicro,
  schema,
} from "@habit-gamba/db";
import { createLogger } from "@habit-gamba/logger";
import { grantUserRole, hasUserPermission } from "@habit-gamba/users";
import { creditRep } from "@habit-gamba/wallet";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { createServerObservability } from "./observability";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../packages/db/drizzle", import.meta.url).pathname;
const testCommunity = {
  displayName: "Habit Gamba",
  provider: "system",
  providerCommunityId: "default",
};

maybeDescribe("server API", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 8 });
  const app = createApp({
    botApiToken: "server-test-bot-token",
    db: client.db,
    pingDb: async () => {
      await client.sql`select 1`;
    },
  });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("wraps health responses", async () => {
    const response = await app.request("/health");
    const body = await json<ApiOk<HealthResponse>>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      data: {
        ok: true,
        service: "server",
      },
    });
  });

  it("emits request observability and exposes metrics", async () => {
    const lines: string[] = [];
    const observability = createServerObservability({
      env: "test",
      logger: createLogger({
        env: "test",
        service: "server",
        write: (line) => lines.push(line),
      }),
    });
    const observedApp = createApp({
      botApiToken: "server-test-bot-token",
      db: client.db,
      observability,
    });
    const response = await observedApp.request("/health", {
      headers: { "X-Request-Id": "request-test-1" },
    });
    const metrics = await observedApp.request("/metrics");
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;

    expect(response.headers.get("X-Request-Id")).toBe("request-test-1");
    expect(parsed).toMatchObject({
      event: "http_request",
      method: "GET",
      outcome: "success",
      request_id: "request-test-1",
      service: "server",
      status_code: 200,
    });
    expect(await metrics.text()).toContain("habit_gamba_http_requests_total");
  });

  it("validates writes and requires an existing active header identity", async () => {
    const missingAuth = await requestJson("/markets", {
      body: {
        slug: `api-auth-${createId().toLowerCase()}`,
        title: "Will auth fail?",
      },
      headers: communityHeaders(),
      method: "POST",
    });
    const unknownUser = await requestJson("/markets", {
      body: {
        slug: `api-auth-${createId().toLowerCase()}`,
        title: "Will user mapping fail?",
      },
      headers: authHeaders("api-test", "missing"),
      method: "POST",
    });

    expect(missingAuth.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect((await json<ApiErrorResponse>(missingAuth)).error.code).toBe("UNAUTHORIZED");
  });

  it("registers provider-neutral accounts through trusted bot auth", async () => {
    const missingToken = await requestJson("/accounts/register", {
      body: {
        communityDisplayName: testCommunity.displayName,
        communityProvider: testCommunity.provider,
        displayName: "Discord User",
        provider: "discord",
        providerCommunityId: testCommunity.providerCommunityId,
        providerUserId: `discord-${createId()}`,
      },
      method: "POST",
    });
    const providerUserId = `discord-${createId()}`;
    const handle = `discord-user-${createId().toLowerCase()}`;
    const adminProviderUserId = `discord-admin-${createId()}`;
    const registered = await requestJson("/accounts/register", {
      body: {
        communityDisplayName: testCommunity.displayName,
        communityProvider: testCommunity.provider,
        displayName: "Discord User",
        handle,
        provider: "discord",
        providerCommunityId: testCommunity.providerCommunityId,
        providerUserId,
      },
      headers: botHeaders(),
      method: "POST",
    });
    const registeredAdmin = await requestJson("/accounts/register", {
      body: {
        admin: true,
        communityDisplayName: testCommunity.displayName,
        communityProvider: testCommunity.provider,
        displayName: "Discord Admin",
        provider: "discord",
        providerCommunityId: testCommunity.providerCommunityId,
        providerUserId: adminProviderUserId,
      },
      headers: botHeaders(),
      method: "POST",
    });
    const account = await app.request("/accounts/me", {
      headers: authHeaders("discord", providerUserId),
    });
    const adminAccount = await app.request("/accounts/me", {
      headers: authHeaders("discord", adminProviderUserId),
    });
    const accountBody = await jsonOk<AccountResponse>(account);
    const adminAccountBody = await jsonOk<AccountResponse>(adminAccount);

    expect(missingToken.status).toBe(401);
    expect(registered.status).toBe(201);
    expect(registeredAdmin.status).toBe(201);
    expect(account.status).toBe(200);
    expect(accountBody.balance.availableAmountMicro).toBe(repToMicro(1_000n).toString());
    expect(
      await hasUserPermission({
        db: client.db,
        permission: "account.adjust",
        userId: adminAccountBody.user.id,
      }),
    ).toBe(true);
  });

  it("creates draft markets, opens them by creator, reads without auth, and serializes bigints", async () => {
    const creator = await insertUser("creator");
    const market = await createMarket(creator.provider, creator.providerUserId);
    const readDraft = await app.request(`/markets/${market.id}`, { headers: communityHeaders() });
    const openedResponse = await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    const openedBody = await jsonOk<OpenMarketResponse>(openedResponse);

    expect(readDraft.status).toBe(200);
    expect(market.status).toBe("draft");
    expect(openedResponse.status).toBe(200);
    expect(openedBody.status).toBe("open");
    expect(typeof openedBody.liquidityParameterMicro).toBe("string");
    expect(openedBody.contracts).toHaveLength(2);
  });

  it("rejects non-creator open and resolve attempts", async () => {
    const creator = await insertUser("owner");
    const other = await insertUser("other");
    const market = await createMarket(creator.provider, creator.providerUserId);
    const openResponse = await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(other.provider, other.providerUserId),
      method: "POST",
    });
    const resolveResponse = await requestJson(`/markets/${market.id}/resolve`, {
      body: {
        outcome: "YES",
      },
      headers: authHeaders(other.provider, other.providerUserId),
      method: "POST",
    });

    expect(openResponse.status).toBe(403);
    expect(resolveResponse.status).toBe(403);
  });

  it("returns hydrated market views after creator resolve and cancel", async () => {
    const resolver = await insertUser("resolver-owner");
    const bettor = await insertUser("resolver-bettor");
    const canceler = await insertUser("cancel-owner");
    const resolveMarket = await createMarket(resolver.provider, resolver.providerUserId);
    const cancelMarket = await createMarket(canceler.provider, canceler.providerUserId);

    await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(100n),
      db: client.db,
      idempotencyKey: `server-test:${bettor.id}:resolve-fund`,
      sourceId: `server-test:${bettor.id}:resolve-fund`,
      sourceType: "server_test_fund",
      userId: bettor.id,
    });
    await requestJson(`/markets/${resolveMarket.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(resolver.provider, resolver.providerUserId),
      method: "POST",
    });
    const buyResponse = await requestJson(`/markets/${resolveMarket.id}/buy`, {
      body: {
        amountMicro: repToMicro(10n).toString(),
        outcome: "NO",
      },
      headers: {
        ...authHeaders(bettor.provider, bettor.providerUserId),
        "Idempotency-Key": `server-test:${bettor.id}:resolve-buy`,
      },
      method: "POST",
    });
    const buyBody = await jsonOk<BuyMarketResponse>(buyResponse);

    const resolveResponse = await requestJson(`/markets/${resolveMarket.id}/resolve`, {
      body: {
        evidence: {
          note: "proof note",
        },
        outcome: "YES",
      },
      headers: authHeaders(resolver.provider, resolver.providerUserId),
      method: "POST",
    });
    const cancelResponse = await requestJson(`/markets/${cancelMarket.id}/cancel`, {
      body: {
        reason: "creator cancelled",
      },
      headers: authHeaders(canceler.provider, canceler.providerUserId),
      method: "POST",
    });
    const resolveBody = await jsonOk<ResolveMarketResponse>(resolveResponse);
    const cancelBody = await jsonOk<CancelMarketResponse>(cancelResponse);
    const resolvedRead = await app.request(`/markets/${resolveMarket.id}`, {
      headers: communityHeaders(),
    });
    const resolvedReadBody = await jsonOk<MarketResponse>(resolvedRead);
    const idempotentResolve = await requestJson(`/markets/${resolveMarket.id}/resolve`, {
      body: {
        outcome: "YES",
      },
      headers: authHeaders(resolver.provider, resolver.providerUserId),
      method: "POST",
    });
    const idempotentResolveBody = await jsonOk<ResolveMarketResponse>(idempotentResolve);

    expect(buyResponse.status).toBe(201);
    expect(resolveResponse.status).toBe(201);
    expect(resolveBody.market.status).toBe("resolved");
    expect(resolveBody.market.contracts).toHaveLength(2);
    expect(resolveBody.market.prices).toEqual(buyBody.market.prices);
    expect(resolveBody.market.prices).toMatchObject({
      no: expect.any(Number),
      yes: expect.any(Number),
    });
    expect(resolveBody.market.prices.yes).toBeLessThan(0.5);
    expect(resolveBody.market.prices.no).toBeGreaterThan(0.5);
    expect(resolvedReadBody.prices).toEqual(buyBody.market.prices);
    expect(idempotentResolve.status).toBe(200);
    expect(idempotentResolveBody.market.prices).toEqual(buyBody.market.prices);
    expect(typeof resolveBody.market.contracts[0]?.shareSupplyMicro).toBe("string");
    expect(cancelResponse.status).toBe(201);
    expect(cancelBody.market.status).toBe("void");
    expect(cancelBody.market.contracts).toHaveLength(2);
    expect(cancelBody.market.prices).toMatchObject({
      no: expect.any(Number),
      yes: expect.any(Number),
    });
  });

  it("validates quote and buy requests, requires idempotency for buys, and returns buy result", async () => {
    const creator = await insertUser("buyer-creator");
    const buyer = await insertUser("buyer");
    const market = await createMarket(creator.provider, creator.providerUserId);

    await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(100n),
      db: client.db,
      idempotencyKey: `server-test:${buyer.id}:fund`,
      sourceId: `server-test:${buyer.id}:fund`,
      sourceType: "server_test_fund",
      userId: buyer.id,
    });
    await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });

    const badQuote = await requestJson(`/markets/${market.id}/quote`, {
      body: {
        amountMicro: "0",
        outcome: "YES",
      },
      method: "POST",
    });
    const tinyQuote = await requestJson(`/markets/${market.id}/quote`, {
      body: {
        amountMicro: "9999",
        outcome: "YES",
      },
      method: "POST",
    });
    const missingKey = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "1000000",
        outcome: "YES",
      },
      headers: authHeaders(buyer.provider, buyer.providerUserId),
      method: "POST",
    });
    const tinyBuy = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "9999",
        outcome: "YES",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:tiny-buy`,
      },
      method: "POST",
    });
    const buySharesQuote = await requestJson(`/markets/${market.id}/quote`, {
      body: {
        amountMicro: "2000000",
        mode: "buy_shares",
        outcome: "NO",
      },
      method: "POST",
    });
    const buy = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "1000000",
        outcome: "YES",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:buy`,
      },
      method: "POST",
    });
    const buySharesBuy = await requestJson(`/markets/${market.id}/buy`, {
      body: {
        amountMicro: "2000000",
        mode: "buy_shares",
        outcome: "NO",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:buy-shares-buy`,
      },
      method: "POST",
    });
    const sellQuote = await requestJson(`/markets/${market.id}/quote`, {
      body: {
        amountMicro: "1000000",
        mode: "sell_shares",
        outcome: "YES",
      },
      headers: authHeaders(buyer.provider, buyer.providerUserId),
      method: "POST",
    });
    const missingSellKey = await requestJson(`/markets/${market.id}/sell`, {
      body: {
        amountMicro: "1000000",
        mode: "sell_shares",
        outcome: "YES",
      },
      headers: authHeaders(buyer.provider, buyer.providerUserId),
      method: "POST",
    });
    const sell = await requestJson(`/markets/${market.id}/sell`, {
      body: {
        amountMicro: "1000000",
        mode: "sell_shares",
        outcome: "YES",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:sell`,
      },
      method: "POST",
    });
    const targetRepSell = await requestJson(`/markets/${market.id}/sell`, {
      body: {
        amountMicro: "10000",
        mode: "target_rep",
        outcome: "NO",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:target-rep-sell`,
      },
      method: "POST",
    });
    const insufficientSell = await requestJson(`/markets/${market.id}/sell`, {
      body: {
        amountMicro: "1000000",
        mode: "sell_shares",
        outcome: "YES",
      },
      headers: {
        ...authHeaders(buyer.provider, buyer.providerUserId),
        "Idempotency-Key": `server-test:${buyer.id}:insufficient-sell`,
      },
      method: "POST",
    });
    const buySharesQuoteBody = await jsonOk<QuoteMarketResponse>(buySharesQuote);
    const buyBody = await jsonOk<BuyMarketResponse>(buy);
    const buySharesBuyBody = await jsonOk<BuyMarketResponse>(buySharesBuy);
    const sellQuoteBody = await jsonOk<QuoteMarketResponse>(sellQuote);
    const sellBody = await jsonOk<SellMarketResponse>(sell);
    const targetRepSellBody = await jsonOk<SellMarketResponse>(targetRepSell);

    expect(badQuote.status).toBe(400);
    expect(tinyQuote.status).toBe(400);
    expect(missingKey.status).toBe(400);
    expect(tinyBuy.status).toBe(400);
    expect(buySharesQuote.status).toBe(200);
    expect(buy.status).toBe(201);
    expect(buySharesBuy.status).toBe(201);
    expect(sellQuote.status).toBe(200);
    expect(missingSellKey.status).toBe(400);
    expect(sell.status).toBe(201);
    expect(targetRepSell.status).toBe(201);
    expect(insufficientSell.status).toBe(422);
    expect(typeof buySharesQuoteBody.costMicro).toBe("string");
    expect(buySharesQuoteBody.sharesMicro).toBe("2000000");
    expect(typeof buyBody.quote.costMicro).toBe("string");
    expect(buyBody.trade.userId).toBe(buyer.id);
    expect(buySharesBuyBody.quote.sharesMicro).toBe("2000000");
    expect(sellQuoteBody.sharesMicro).toBe("1000000");
    expect(sellBody.trade.side).toBe("sell");
    expect(sellBody.trade.cashDeltaMicro).toBe(sellBody.quote.costMicro);
    expect(BigInt(targetRepSellBody.quote.costMicro)).toBeGreaterThanOrEqual(10000n);
  });

  it("allows global market admins to manage other users' markets", async () => {
    const creator = await insertUser("admin-owner");
    const admin = await insertUser("market-admin");
    const market = await createMarket(creator.provider, creator.providerUserId);

    await grantUserRole({ db: client.db, role: "market_admin", userId: admin.id });
    await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(admin.provider, admin.providerUserId),
      method: "POST",
    });

    const deniedCreatorClose = await requestJson(`/markets/${market.id}/close`, {
      body: {},
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    const closeResponse = await requestJson(`/markets/${market.id}/close`, {
      body: {},
      headers: authHeaders(admin.provider, admin.providerUserId),
      method: "POST",
    });
    const closeBody = await jsonOk<CloseMarketResponse>(closeResponse);

    expect(deniedCreatorClose.status).toBe(403);
    expect(closeResponse.status).toBe(200);
    expect(closeBody.status).toBe("closed");
  });

  it("guards market refresh trades to creators and market admins", async () => {
    const creator = await insertUser("refresh-owner");
    const other = await insertUser("refresh-other");
    const admin = await insertUser("refresh-admin");
    const market = await createMarket(creator.provider, creator.providerUserId);

    await grantUserRole({ db: client.db, role: "market_admin", userId: admin.id });
    await requestJson(`/markets/${market.id}/open`, {
      body: {
        closesAt: "2099-01-01T00:00:00.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });

    const missingActor = await app.request(`/markets/${market.id}/refresh-trades`, {
      headers: botHeaders(),
    });
    const deniedOther = await app.request(`/markets/${market.id}/refresh-trades`, {
      headers: {
        ...botHeaders(),
        ...authHeaders(other.provider, other.providerUserId),
      },
    });
    const creatorResponse = await app.request(`/markets/${market.id}/refresh-trades`, {
      headers: {
        ...botHeaders(),
        ...authHeaders(creator.provider, creator.providerUserId),
      },
    });
    const adminResponse = await app.request(`/markets/${market.id}/refresh-trades`, {
      headers: {
        ...botHeaders(),
        ...authHeaders(admin.provider, admin.providerUserId),
      },
    });

    expect(missingActor.status).toBe(401);
    expect(deniedOther.status).toBe(403);
    expect(creatorResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
  });

  it("lets app admins adjust registered user balances with idempotency", async () => {
    const admin = await insertUser("account-admin");
    const nonAdmin = await insertUser("account-non-admin");
    const target = await insertUser("account-target");

    await grantUserRole({ db: client.db, role: "admin", userId: admin.id });

    const denied = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(10n).toString(),
        direction: "credit",
        reason: "test denied",
      },
      headers: {
        ...authHeaders(nonAdmin.provider, nonAdmin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:denied-adjustment`,
      },
      method: "POST",
    });
    const credit = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(10n).toString(),
        direction: "credit",
        reason: "manual credit",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:admin-credit`,
      },
      method: "POST",
    });
    const duplicateCredit = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(10n).toString(),
        direction: "credit",
        reason: "manual credit",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:admin-credit`,
      },
      method: "POST",
    });
    const conflictingCredit = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(11n).toString(),
        direction: "credit",
        reason: "manual credit",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:admin-credit`,
      },
      method: "POST",
    });
    const debit = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(3n).toString(),
        direction: "debit",
        reason: "manual debit",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:admin-debit`,
      },
      method: "POST",
    });
    const ledgerCountBeforeRejectedDebit = (
      await client.db.select().from(schema.ledgerEntries)
    ).filter((entry) => entry.userId === target.id).length;
    const rejectedDebit = await requestJson(`/accounts/${target.id}/adjustments`, {
      body: {
        amountMicro: repToMicro(100n).toString(),
        direction: "debit",
        reason: "too much",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:admin-debit-too-much`,
      },
      method: "POST",
    });
    const missingTarget = await requestJson(`/accounts/${createId()}/adjustments`, {
      body: {
        amountMicro: repToMicro(1n).toString(),
        direction: "credit",
        reason: "missing",
      },
      headers: {
        ...authHeaders(admin.provider, admin.providerUserId),
        "Idempotency-Key": `server-test:${target.id}:missing-target`,
      },
      method: "POST",
    });
    const creditBody = await jsonOk<AccountAdjustmentResponse>(credit);
    const duplicateCreditBody = await jsonOk<AccountAdjustmentResponse>(duplicateCredit);
    const debitBody = await jsonOk<AccountAdjustmentResponse>(debit);
    const ledgerRows = (await client.db.select().from(schema.ledgerEntries)).filter(
      (entry) => entry.userId === target.id,
    );

    expect(denied.status).toBe(403);
    expect(credit.status).toBe(201);
    expect(creditBody.balance.availableAmountMicro).toBe(repToMicro(10n).toString());
    expect(creditBody.ledgerEntry.reason).toBe("adjustment");
    expect(creditBody.ledgerEntry.metadata).toMatchObject({
      actorUserId: admin.id,
      direction: "credit",
      reason: "manual credit",
      source: "discord_admin_command",
    });
    expect(duplicateCredit.status).toBe(200);
    expect(duplicateCreditBody.idempotent).toBe(true);
    expect(duplicateCreditBody.ledgerEntry.id).toBe(creditBody.ledgerEntry.id);
    expect(conflictingCredit.status).toBe(409);
    expect(debit.status).toBe(201);
    expect(debitBody.balance.availableAmountMicro).toBe(repToMicro(7n).toString());
    expect(debitBody.ledgerEntry.reason).toBe("adjustment");
    expect(debitBody.ledgerEntry.amountDeltaMicro).toBe((-repToMicro(3n)).toString());
    expect(rejectedDebit.status).toBe(422);
    expect(missingTarget.status).toBe(404);
    expect(ledgerRows).toHaveLength(ledgerCountBeforeRejectedDebit);
  });

  it("resolves markets by Discord thread metadata for internal bot callers", async () => {
    const lines: string[] = [];
    const observedApp = createApp({
      botApiToken: "server-test-bot-token",
      db: client.db,
      observability: createServerObservability({
        env: "test",
        logger: createLogger({
          env: "test",
          service: "server",
          write: (line) => lines.push(line),
        }),
      }),
    });
    const creator = await insertUser("discord-thread-owner");
    const missing = await app.request("/markets/by-discord-thread/missing-thread", {
      headers: botHeaders(),
    });
    const unauthorized = await app.request("/markets/by-discord-thread/missing-thread");
    const first = await createMarket(creator.provider, creator.providerUserId, {
      discord: { threadId: "thread-duplicate" },
      source: "server-test",
    });
    const linked = await createMarket(creator.provider, creator.providerUserId, {
      discord: { threadId: "thread-linked" },
      source: "server-test",
    });
    const duplicate = await createMarket(creator.provider, creator.providerUserId, {
      discord: { threadId: "thread-duplicate" },
      source: "server-test",
    });
    const linkedResponse = await app.request("/markets/by-discord-thread/thread-linked", {
      headers: botHeaders(),
    });
    const duplicateResponse = await observedApp.request(
      "/markets/by-discord-thread/thread-duplicate",
      {
        headers: botHeaders(),
      },
    );
    const linkedBody = await jsonOk<MarketResponse>(linkedResponse);
    const duplicateBody = await jsonOk<MarketResponse>(duplicateResponse);

    expect(unauthorized.status).toBe(401);
    expect(missing.status).toBe(404);
    expect(linkedResponse.status).toBe(200);
    expect(linkedBody.id).toBe(linked.id);
    expect(linkedBody.contracts).toHaveLength(2);
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody.id).toBe(duplicate.id);
    expect(duplicateBody.id).not.toBe(first.id);
    expect(lines.some((line) => line.includes("duplicate_discord_thread_market_metadata"))).toBe(
      true,
    );
  });

  it("schedules EOD reminder deliveries when Discord thread metadata is patched", async () => {
    const creator = await insertUser("reminder-owner", "discord");
    const openMarket = await createMarket(creator.provider, creator.providerUserId);
    const closedMarket = await createMarket(creator.provider, creator.providerUserId);

    await requestJson(`/markets/${openMarket.id}/open`, {
      body: {
        closesAt: "2099-01-01T04:59:59.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    await requestJson(`/markets/${closedMarket.id}/open`, {
      body: {
        closesAt: "2099-01-01T04:59:59.000Z",
      },
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });
    await grantUserRole({ db: client.db, role: "market_admin", userId: creator.id });
    await requestJson(`/markets/${closedMarket.id}/close`, {
      body: {},
      headers: authHeaders(creator.provider, creator.providerUserId),
      method: "POST",
    });

    const firstPatch = await requestJson(`/markets/${openMarket.id}/metadata`, {
      body: {
        metadata: {
          discord: { threadId: `thread-${openMarket.id}` },
        },
      },
      headers: botHeaders(),
      method: "PATCH",
    });
    const duplicatePatch = await requestJson(`/markets/${openMarket.id}/metadata`, {
      body: {
        metadata: {
          discord: { threadId: `thread-${openMarket.id}` },
        },
      },
      headers: botHeaders(),
      method: "PATCH",
    });
    const closedPatch = await requestJson(`/markets/${closedMarket.id}/metadata`, {
      body: {
        metadata: {
          discord: { threadId: `thread-${closedMarket.id}` },
        },
      },
      headers: botHeaders(),
      method: "PATCH",
    });
    const rows = await client.db
      .select()
      .from(schema.marketReminderDeliveries)
      .where(eq(schema.marketReminderDeliveries.marketId, openMarket.id));
    const closedRows = await client.db
      .select()
      .from(schema.marketReminderDeliveries)
      .where(eq(schema.marketReminderDeliveries.marketId, closedMarket.id));

    expect(firstPatch.status).toBe(200);
    expect(duplicatePatch.status).toBe(200);
    expect(closedPatch.status).toBe(200);
    expect(rows.map((row) => row.slotKey).sort()).toEqual(["eod_18_et", "eod_22_et"]);
    expect(new Set(rows.map((row) => row.recipientUserId))).toEqual(new Set([creator.id]));
    expect(closedRows).toHaveLength(0);
  });

  it("returns public portfolio and leaderboard reads", async () => {
    const user = await insertUser("portfolio");

    await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(12n),
      db: client.db,
      idempotencyKey: `server-test:${user.id}:portfolio-fund`,
      sourceId: `server-test:${user.id}:portfolio-fund`,
      sourceType: "server_test_fund",
      userId: user.id,
    });

    const portfolio = await app.request(`/users/${user.id}/portfolio`, {
      headers: communityHeaders(),
    });
    const portfolioBody = await jsonOk<AccountResponse>(portfolio);
    const leaderboard = await app.request("/leaderboard?limit=5", { headers: communityHeaders() });
    const leaderboardBody = await jsonOk<LeaderboardResponse>(leaderboard);

    expect(portfolio.status).toBe(200);
    expect(portfolioBody.user.id).toBe(user.id);
    expect(portfolioBody.balance.availableAmountMicro).toBe(repToMicro(12n).toString());
    expect(leaderboard.status).toBe(200);
    expect(leaderboardBody.entries.length).toBeLessThanOrEqual(5);
    expect(typeof leaderboardBody.entries[0]?.balance.availableAmountMicro).toBe("string");
  });

  async function createMarket(
    provider: string,
    providerUserId: string,
    metadata: Record<string, unknown> = { source: "server-test" },
  ) {
    const response = await requestJson("/markets", {
      body: {
        metadata,
        slug: `server-test-${createId().toLowerCase()}`,
        title: "Will the API work?",
      },
      headers: authHeaders(provider, providerUserId),
      method: "POST",
    });
    const body = await jsonOk<CreateMarketResponse>(response);

    expect(response.status).toBe(201);

    return body.market;
  }

  async function insertUser(label: string, provider = "server-test") {
    const id = createId();
    const providerUserId = `${label}-${id}`;

    const [user] = await client.db
      .insert(schema.users)
      .values({
        displayName: `Server Test ${label}`,
        id,
        provider,
        providerUserId,
      })
      .returning();

    if (!user) {
      throw new Error("Failed to create test user");
    }

    await client.db
      .insert(schema.communities)
      .values({
        displayName: testCommunity.displayName,
        id: DEFAULT_COMMUNITY_ID,
        provider: testCommunity.provider,
        providerCommunityId: testCommunity.providerCommunityId,
        slug: "server-test-community",
      })
      .onConflictDoNothing();
    await client.db
      .insert(schema.communityMemberships)
      .values({
        communityId: DEFAULT_COMMUNITY_ID,
        displayNameSnapshot: user.displayName,
        id: `${user.id}:server-test-membership`,
        providerMemberId: user.providerUserId,
        userId: user.id,
      })
      .onConflictDoNothing();

    return user;
  }

  function requestJson(
    path: string,
    input: {
      body: unknown;
      headers?: Record<string, string>;
      method: "PATCH" | "POST";
    },
  ) {
    return app.request(path, {
      body: JSON.stringify(input.body),
      headers: {
        "Content-Type": "application/json",
        ...communityHeaders(),
        ...input.headers,
      },
      method: input.method,
    });
  }
});

function authHeaders(provider: string, providerUserId: string) {
  return {
    ...communityHeaders(),
    "X-Provider": provider,
    "X-Provider-User-Id": providerUserId,
  };
}

function communityHeaders() {
  return {
    "X-Community-Provider": testCommunity.provider,
    "X-Provider-Community-Id": testCommunity.providerCommunityId,
  };
}

function botHeaders() {
  return {
    Authorization: "Bearer server-test-bot-token",
    ...communityHeaders(),
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function jsonOk<T>(response: Response): Promise<Serialized<T>> {
  return (await json<ApiOk<T>>(response)).data;
}
