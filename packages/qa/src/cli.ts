#!/usr/bin/env bun
import { createDbClient } from "@habit-gamba/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { runQaCheck, runQaScenario } from "./runner";
import { setupQaFixtures } from "./setup";
import type { QaCommandResult, QaScenarioName, QaScopeName } from "./types";

type CliOptions = {
  adminDatabaseUrl?: string;
  allowDestructive: boolean;
  command: "check" | "run" | "setup";
  databaseUrl?: string;
  json: boolean;
  scenario?: QaScenarioName;
  scope: QaScopeName;
  seed?: number;
  setupIsolatedDb: boolean;
  trades?: number;
};

const QA_DATABASE_NAME = "habit_gamba_qa";
const migrationsFolder = new URL("../../db/drizzle", import.meta.url).pathname;

export async function runCli(argv = process.argv.slice(2), env = process.env): Promise<number> {
  try {
    const options = parseArgs(argv);

    if (options.trades !== undefined) {
      throw new Error("TODO: --trades requires exchange trade API before QA can stress trades");
    }

    const databaseUrl = resolveDatabaseUrl(options, env);

    if (options.setupIsolatedDb) {
      if (!options.allowDestructive) {
        throw new Error("--setup-isolated-db requires --allow-destructive");
      }

      await recreateIsolatedDatabase({
        adminDatabaseUrl: resolveAdminDatabaseUrl(options, env),
        databaseName: getDatabaseName(databaseUrl),
      });
    }

    const client = createDbClient({ databaseUrl, max: 4 });

    try {
      if (options.command !== "check" || options.setupIsolatedDb) {
        await migrate(client.db, { migrationsFolder });
      }

      if (options.command === "setup") {
        await setupQaFixtures({ db: client.db });
        writeOutput(options, {
          checkpoints: [],
          ok: true,
        });
        return 0;
      }

      const result =
        options.command === "check"
          ? await runQaCheck({ db: client.db, scope: { kind: options.scope } })
          : await runQaScenario({
              db: client.db,
              scenario: options.scenario ?? "happy-path",
              ...(options.scope === "all" ? { scope: { kind: "all" } as const } : {}),
              ...(options.seed === undefined ? {} : { seed: options.seed }),
            });

      writeOutput(options, result);
      return result.ok ? 0 : 1;
    } finally {
      await client.sql.end();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function parseArgs(argv: string[]): CliOptions {
  const [command, maybeScenario, ...rest] = argv;

  if (command !== "setup" && command !== "run" && command !== "check") {
    throw new Error("Usage: qa setup | qa check [--scope all|qa] | qa run <scenario>");
  }

  const options: CliOptions = {
    allowDestructive: false,
    command,
    json: false,
    scope: "all",
    setupIsolatedDb: false,
  };
  const args = command === "run" ? rest : [maybeScenario, ...rest].filter(isString);

  if (command === "run") {
    if (!isScenario(maybeScenario)) {
      throw new Error("Usage: qa run happy-path|cancellation|stress");
    }

    options.scenario = maybeScenario;
    options.scope = "qa";
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--allow-destructive") {
      options.allowDestructive = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--setup-isolated-db") {
      options.setupIsolatedDb = true;
      continue;
    }

    if (arg === "--admin-database-url") {
      options.adminDatabaseUrl = readFlagValue(args, ++index, arg);
      continue;
    }

    if (arg === "--database-url") {
      options.databaseUrl = readFlagValue(args, ++index, arg);
      continue;
    }

    if (arg === "--scope") {
      const value = readFlagValue(args, ++index, arg);
      if (value !== "all" && value !== "qa") {
        throw new Error("--scope must be all or qa");
      }
      options.scope = value;
      continue;
    }

    if (arg === "--seed") {
      const seed = Number(readFlagValue(args, ++index, arg));
      if (!Number.isInteger(seed)) {
        throw new Error("--seed must be an integer");
      }
      options.seed = seed;
      continue;
    }

    if (arg === "--trades") {
      const trades = Number(readFlagValue(args, ++index, arg));
      if (!Number.isInteger(trades) || trades < 0) {
        throw new Error("--trades must be a nonnegative integer");
      }
      options.trades = trades;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function recreateIsolatedDatabase(input: { adminDatabaseUrl: string; databaseName: string }) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.databaseName)) {
    throw new Error(`Unsafe database name: ${input.databaseName}`);
  }

  const adminSql = postgres(input.adminDatabaseUrl, { max: 1 });

  try {
    await adminSql`drop database if exists ${adminSql(input.databaseName)} with (force)`;
    await adminSql`create database ${adminSql(input.databaseName)}`;
  } finally {
    await adminSql.end();
  }
}

function resolveDatabaseUrl(options: CliOptions, env: NodeJS.ProcessEnv): string {
  if (options.databaseUrl) {
    return options.setupIsolatedDb
      ? withDatabaseName(options.databaseUrl, QA_DATABASE_NAME)
      : options.databaseUrl;
  }

  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL or --database-url is required");
  }

  return options.setupIsolatedDb ? withDatabaseName(databaseUrl, QA_DATABASE_NAME) : databaseUrl;
}

function resolveAdminDatabaseUrl(options: CliOptions, env: NodeJS.ProcessEnv): string {
  if (options.adminDatabaseUrl) {
    return options.adminDatabaseUrl;
  }

  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL, --database-url, or --admin-database-url is required");
  }

  return withDatabaseName(databaseUrl, "postgres");
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function getDatabaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");

  if (!name) {
    throw new Error("Database URL must include database name");
  }

  return decodeURIComponent(name);
}

function writeOutput(options: CliOptions, result: QaCommandResult) {
  if (options.json) {
    console.log(JSON.stringify(result, bigIntJsonReplacer, 2));
    return;
  }

  if (result.checkpoints.length === 0) {
    console.log("qa setup ok");
    return;
  }

  for (const checkpoint of result.checkpoints) {
    const failedReports = checkpoint.reports.filter((report) => !report.ok);
    const action = checkpoint.actionName ? ` ${checkpoint.actionName}` : "";
    console.log(`${checkpoint.label}${action}: ${failedReports.length === 0 ? "ok" : "failed"}`);

    for (const report of failedReports) {
      console.log(`  ${report.name}: ${report.failures.length} failure(s)`);
      for (const failure of report.failures) {
        const entity = failure.entity ? ` [${failure.entity.type}:${failure.entity.id}]` : "";
        console.log(`    ${failure.code}${entity}: ${failure.message}`);

        if (failure.details) {
          console.log(`      details: ${JSON.stringify(failure.details, bigIntJsonReplacer)}`);
        }
      }
    }
  }
}

function bigIntJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function isScenario(value: string | undefined): value is QaScenarioName {
  return value === "happy-path" || value === "cancellation" || value === "stress";
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

if (import.meta.main) {
  process.exitCode = await runCli();
}
