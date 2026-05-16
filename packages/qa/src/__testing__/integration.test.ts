import { createDbClient, schema } from "@habit-gamba/db";
import { getBalance } from "@habit-gamba/wallet";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQaScenario } from "../runner";
import { setupQaFixtures } from "../setup";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../db/drizzle", import.meta.url).pathname;

maybeDescribe("qa setup and runner", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 2 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("sets up QA fixtures idempotently and only grants balance deltas", async () => {
    const first = await setupQaFixtures({ db: client.db, minimumRepMicro: 10n });
    const second = await setupQaFixtures({ db: client.db, minimumRepMicro: 10n });
    const balance = await getBalance({ db: client.db, userId: first.users[0]?.id ?? "" });
    const ledgerRows = await client.db.select().from(schema.ledgerEntries);
    const firstUserSetupRows = ledgerRows.filter(
      (entry) => entry.userId === first.users[0]?.id && entry.metadata.qaSetup === true,
    );

    expect(second.users.map((user) => user.id)).toEqual(first.users.map((user) => user.id));
    expect(balance.availableAmountMicro).toBeGreaterThanOrEqual(10n);
    expect(firstUserSetupRows).toHaveLength(1);
  });

  it("runs happy-path with scoped invariants after each action", async () => {
    const result = await runQaScenario({
      db: client.db,
      scenario: "happy-path",
      seed: 123,
    });

    expect(result.ok).toBe(true);
    expect(result.checkpoints.map((checkpoint) => checkpoint.label)).toEqual([
      "before-scenario",
      "after-action",
      "after-action",
      "after-action",
      "after-scenario",
    ]);
  });
});
