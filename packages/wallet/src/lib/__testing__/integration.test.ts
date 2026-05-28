import {
  DEFAULT_COMMUNITY_ID,
  createDbClient,
  createId,
  repToMicro,
  schema,
} from "@habit-gamba/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "../../../../db/scripts/seed";
import { checkRepLedgerInvariant } from "./invariants";
import {
  creditRep,
  debitRep,
  getBalance,
  IdempotencyConflictError,
  InsufficientFundsError,
  setRepCreditLimit,
} from "../../index";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../db/drizzle", import.meta.url).pathname;

maybeDescribe("wallet REP ledger", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 4 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("creditRep creates ledger entry and balance projection", async () => {
    const userId = await createTestUser(client.db);

    const result = await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(10n),
      db: client.db,
      idempotencyKey: `wallet-test:${userId}:credit`,
      sourceId: createId(),
      sourceType: "test_credit",
      userId,
    });

    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });
    const ledgerRows = await client.db.select().from(schema.ledgerEntries);

    expect(result.idempotent).toBe(false);
    expect(result.ledgerEntry.amountDeltaMicro).toBe(repToMicro(10n));
    expect(result.ledgerEntry.balanceAfterMicro).toBe(repToMicro(10n));
    expect(balance.availableAmountMicro).toBe(repToMicro(10n));
    expect(ledgerRows.filter((entry) => entry.userId === userId)).toHaveLength(1);
  });

  it("debitRep rejects insufficient funds without ledger entry", async () => {
    const userId = await createTestUser(client.db);

    await expect(
      debitRep({
        communityId: DEFAULT_COMMUNITY_ID,
        amountMicro: 1n,
        db: client.db,
        idempotencyKey: `wallet-test:${userId}:debit-too-much`,
        sourceId: createId(),
        sourceType: "test_debit",
        userId,
      }),
    ).rejects.toThrow(InsufficientFundsError);

    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });
    const userLedgerRows = (await client.db.select().from(schema.ledgerEntries)).filter(
      (entry) => entry.userId === userId,
    );

    expect(balance.availableAmountMicro).toBe(0n);
    expect(userLedgerRows).toHaveLength(0);
  });

  it("setRepCreditLimit permits debt down to limit and rejects beyond it", async () => {
    const userId = await createTestUser(client.db);

    await setRepCreditLimit({
      communityId: DEFAULT_COMMUNITY_ID,
      creditLimitMicro: repToMicro(5n),
      db: client.db,
      userId,
    });

    await debitRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(5n),
      db: client.db,
      idempotencyKey: `wallet-test:${userId}:debit-to-limit`,
      sourceId: createId(),
      sourceType: "test_debit",
      userId,
    });

    await expect(
      debitRep({
        communityId: DEFAULT_COMMUNITY_ID,
        amountMicro: 1n,
        db: client.db,
        idempotencyKey: `wallet-test:${userId}:debit-past-limit`,
        sourceId: createId(),
        sourceType: "test_debit",
        userId,
      }),
    ).rejects.toThrow(InsufficientFundsError);

    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });

    expect(balance.availableAmountMicro).toBe(-repToMicro(5n));
    expect(balance.creditLimitMicro).toBe(repToMicro(5n));
  });

  it("duplicate idempotency key with same payload returns existing ledger entry", async () => {
    const userId = await createTestUser(client.db);
    const idempotencyKey = `wallet-test:${userId}:duplicate`;
    const sourceId = createId();
    const input = {
      amountMicro: repToMicro(3n),
      communityId: DEFAULT_COMMUNITY_ID,
      db: client.db,
      idempotencyKey,
      metadata: { request: "same" },
      sourceId,
      sourceType: "test_credit",
      userId,
    };

    const first = await creditRep(input);
    const second = await creditRep(input);
    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });
    const userLedgerRows = (await client.db.select().from(schema.ledgerEntries)).filter(
      (entry) => entry.userId === userId,
    );

    expect(second.idempotent).toBe(true);
    expect(second.ledgerEntry.id).toBe(first.ledgerEntry.id);
    expect(balance.availableAmountMicro).toBe(repToMicro(3n));
    expect(userLedgerRows).toHaveLength(1);
  });

  it("concurrent duplicate idempotency key with same payload is safe", async () => {
    const userId = await createTestUser(client.db);
    const idempotencyKey = `wallet-test:${userId}:concurrent-duplicate`;
    const sourceId = createId();
    const input = {
      amountMicro: repToMicro(2n),
      communityId: DEFAULT_COMMUNITY_ID,
      db: client.db,
      idempotencyKey,
      sourceId,
      sourceType: "test_credit",
      userId,
    };

    const results = await Promise.all([creditRep(input), creditRep(input)]);
    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });
    const userLedgerRows = (await client.db.select().from(schema.ledgerEntries)).filter(
      (entry) => entry.userId === userId,
    );

    expect(results[0]?.ledgerEntry.id).toBe(results[1]?.ledgerEntry.id);
    expect(balance.availableAmountMicro).toBe(repToMicro(2n));
    expect(userLedgerRows).toHaveLength(1);
  });

  it("duplicate idempotency key with changed payload rejects", async () => {
    const userId = await createTestUser(client.db);
    const idempotencyKey = `wallet-test:${userId}:conflict`;

    await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(3n),
      db: client.db,
      idempotencyKey,
      sourceId: createId(),
      sourceType: "test_credit",
      userId,
    });

    await expect(
      creditRep({
        communityId: DEFAULT_COMMUNITY_ID,
        amountMicro: repToMicro(4n),
        db: client.db,
        idempotencyKey,
        sourceId: createId(),
        sourceType: "test_credit",
        userId,
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("concurrent debit path cannot overspend beyond credit limit", async () => {
    const userId = await createTestUser(client.db);

    await creditRep({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro: repToMicro(10n),
      db: client.db,
      idempotencyKey: `wallet-test:${userId}:fund-concurrent`,
      sourceId: createId(),
      sourceType: "test_credit",
      userId,
    });

    const debits = await Promise.allSettled([
      debitRep({
        communityId: DEFAULT_COMMUNITY_ID,
        amountMicro: repToMicro(10n),
        db: client.db,
        idempotencyKey: `wallet-test:${userId}:concurrent-debit-a`,
        sourceId: createId(),
        sourceType: "test_debit",
        userId,
      }),
      debitRep({
        communityId: DEFAULT_COMMUNITY_ID,
        amountMicro: repToMicro(10n),
        db: client.db,
        idempotencyKey: `wallet-test:${userId}:concurrent-debit-b`,
        sourceId: createId(),
        sourceType: "test_debit",
        userId,
      }),
    ]);

    const fulfilled = debits.filter((debit) => debit.status === "fulfilled");
    const rejected = debits.filter((debit) => debit.status === "rejected");
    const balance = await getBalance({ communityId: DEFAULT_COMMUNITY_ID, db: client.db, userId });

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(balance.availableAmountMicro).toBe(0n);
  });

  it("seeded balances satisfy REP ledger invariant", async () => {
    await seedDatabase(client.db);

    const report = await checkRepLedgerInvariant({ db: client.db });

    expect(report).toEqual({ ok: true, mismatches: [] });
  });
});

async function createTestUser(db: ReturnType<typeof createDbClient>["db"]): Promise<string> {
  const userId = createId();

  await db.insert(schema.users).values({
    displayName: `Wallet Test ${userId}`,
    id: userId,
    provider: "wallet-test",
    providerUserId: userId,
  });

  return userId;
}
