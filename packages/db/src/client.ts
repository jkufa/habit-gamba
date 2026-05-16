import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type DbClientOptions = {
  databaseUrl: string;
  max?: number;
};

export function createDbClient(options: DbClientOptions) {
  const sql = postgres(options.databaseUrl, {
    max: options.max ?? 10,
    transform: postgres.camel,
  });

  return {
    db: drizzle(sql, { schema }),
    sql,
  };
}

export type DbClient = ReturnType<typeof createDbClient>["db"];
