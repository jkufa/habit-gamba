import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { DbClient } from "./client";

export async function runMigrations(input: {
  db: DbClient;
  migrationsFolder?: string;
}): Promise<void> {
  await migrate(input.db, { migrationsFolder: input.migrationsFolder ?? "drizzle" });
}
