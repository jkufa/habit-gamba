import { loadBaseEnv } from "@habit-gamba/env";

import { createDbClient } from "./client";
import { runMigrations } from "./migrations";

const env = loadBaseEnv();
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL, max: 1 });

await runMigrations({ db });
await sql.end();
