import { loadBaseEnv } from "@habit-gamba/env";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDbClient } from "./client";

const env = loadBaseEnv();
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL, max: 1 });

await migrate(db, { migrationsFolder: "drizzle" });
await sql.end();
