import { DEFAULT_COMMUNITY_ID, createDbClient, createId, schema } from "@habit-gamba/db";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deactivateUser,
  ensureSeedRepGrant,
  getUserById,
  getUserByProviderIdentity,
  listUsers,
  updateUserProfile,
  upsertUser,
} from "../..";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe("users lifecycle", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 1 });

  beforeAll(async () => {
    await migrate(client.db, {
      migrationsFolder: new URL("../../../../db/drizzle", import.meta.url).pathname,
    });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("upserts, reads, lists, updates, and deactivates users", async () => {
    const userId = createId();
    const providerUserId = `provider-${userId}`;

    const user = await upsertUser({
      db: client.db,
      displayName: "Lifecycle User",
      handle: `user-${userId.toLowerCase()}`,
      id: userId,
      metadata: { tier: "seed" },
      provider: "test",
      providerUserId,
    });

    expect(user.status).toBe("active");

    const byId = await getUserById({ db: client.db, userId });
    const byProvider = await getUserByProviderIdentity({
      db: client.db,
      provider: "test",
      providerUserId,
    });

    expect(byId?.id).toBe(userId);
    expect(byProvider?.id).toBe(userId);

    const updated = await updateUserProfile({
      db: client.db,
      displayName: "Updated Lifecycle User",
      metadata: { tier: "updated" },
      userId,
    });

    expect(updated.displayName).toBe("Updated Lifecycle User");
    expect(updated.metadata).toEqual({ tier: "updated" });

    const listed = await listUsers({
      db: client.db,
      limit: 1,
      statuses: ["active"],
    });

    expect(listed.users).toHaveLength(1);

    const deactivated = await deactivateUser({ db: client.db, userId });

    expect(deactivated.status).toBe("deactivated");
  });

  it("creates seed grants idempotently and keeps balance equal to ledger sum", async () => {
    const userId = createId();
    const amountMicro = 10_000_000n;

    await upsertUser({
      db: client.db,
      displayName: "Grant User",
      id: userId,
      provider: "test",
      providerUserId: `grant-${userId}`,
    });

    const first = await ensureSeedRepGrant({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro,
      db: client.db,
      idempotencyKey: `grant:${userId}`,
      userId,
    });
    const second = await ensureSeedRepGrant({
      communityId: DEFAULT_COMMUNITY_ID,
      amountMicro,
      db: client.db,
      idempotencyKey: `grant:${userId}`,
      userId,
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.ledgerEntry.id).toBe(first.ledgerEntry.id);

    const userBalances = await client.db
      .select()
      .from(schema.balances)
      .where(eq(schema.balances.userId, userId));
    const ledgerEntries = await client.db
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.userId, userId));
    const ledgerTotal = ledgerEntries.reduce((sum, entry) => sum + entry.amountDeltaMicro, 0n);

    expect(userBalances).toHaveLength(1);
    expect(userBalances[0]?.availableAmountMicro).toBe(ledgerTotal);
  });
});
