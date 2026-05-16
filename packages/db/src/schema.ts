import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const currencyEnum = pgEnum("currency", ["REP"]);
export const marketStatusEnum = pgEnum("market_status", [
  "draft",
  "open",
  "closed",
  "resolved",
  "void",
]);
export const contractOutcomeEnum = pgEnum("contract_outcome", ["YES", "NO"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const ledgerReasonEnum = pgEnum("ledger_reason", [
  "seed_grant",
  "trade",
  "payout",
  "refund",
  "adjustment",
]);
export const resolutionKindEnum = pgEnum("resolution_kind", ["manual", "oracle"]);

function idColumn() {
  return text("id").primaryKey();
}

function createdAtColumn() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

function updatedAtColumn() {
  return timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
}

function metadataColumn(name = "metadata") {
  return jsonb(name)
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`);
}

export const users = pgTable(
  "users",
  {
    id: idColumn(),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    handle: text("handle"),
    displayName: text("display_name").notNull(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("users_provider_user_id_unique").on(table.provider, table.providerUserId),
    unique("users_handle_unique").on(table.handle),
  ],
);

export const balances = pgTable(
  "balances",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    currency: currencyEnum("currency").notNull().default("REP"),
    availableAmountMicro: bigint("available_amount_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lockedAmountMicro: bigint("locked_amount_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("balances_user_currency_unique").on(table.userId, table.currency),
    check("balances_available_nonnegative", sql`${table.availableAmountMicro} >= 0`),
    check("balances_locked_nonnegative", sql`${table.lockedAmountMicro} >= 0`),
  ],
);

export const markets = pgTable(
  "markets",
  {
    id: idColumn(),
    creatorUserId: text("creator_user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: marketStatusEnum("status").notNull().default("draft"),
    currency: currencyEnum("currency").notNull().default("REP"),
    liquidityParameterMicro: bigint("liquidity_parameter_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    oracleAdapter: text("oracle_adapter"),
    oracleRef: text("oracle_ref"),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("markets_slug_unique").on(table.slug),
    index("markets_creator_idx").on(table.creatorUserId),
    index("markets_status_idx").on(table.status),
    check("markets_liquidity_nonnegative", sql`${table.liquidityParameterMicro} >= 0`),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: idColumn(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    outcome: contractOutcomeEnum("outcome").notNull(),
    title: text("title").notNull(),
    shareSupplyMicro: bigint("share_supply_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("contracts_market_outcome_unique").on(table.marketId, table.outcome),
    check("contracts_share_supply_nonnegative", sql`${table.shareSupplyMicro} >= 0`),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    quantityMicro: bigint("quantity_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("positions_user_contract_unique").on(table.userId, table.contractId),
    check("positions_quantity_nonnegative", sql`${table.quantityMicro} >= 0`),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    contractId: text("contract_id")
      .notNull()
      .references(() => contracts.id),
    side: tradeSideEnum("side").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sharesDeltaMicro: bigint("shares_delta_micro", { mode: "bigint" }).notNull(),
    cashDeltaMicro: bigint("cash_delta_micro", { mode: "bigint" }).notNull(),
    feeMicro: bigint("fee_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("trades_idempotency_key_unique").on(table.idempotencyKey),
    index("trades_user_idx").on(table.userId),
    index("trades_market_idx").on(table.marketId),
    check("trades_fee_nonnegative", sql`${table.feeMicro} >= 0`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: idColumn(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    currency: currencyEnum("currency").notNull().default("REP"),
    amountDeltaMicro: bigint("amount_delta_micro", { mode: "bigint" }).notNull(),
    balanceAfterMicro: bigint("balance_after_micro", { mode: "bigint" }).notNull(),
    reason: ledgerReasonEnum("reason").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("ledger_entries_idempotency_key_unique").on(table.idempotencyKey),
    unique("ledger_entries_source_unique").on(table.sourceType, table.sourceId, table.userId),
    index("ledger_entries_user_currency_idx").on(table.userId, table.currency),
  ],
);

export const resolutions = pgTable(
  "resolutions",
  {
    id: idColumn(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    winningContractId: text("winning_contract_id")
      .notNull()
      .references(() => contracts.id),
    resolverUserId: text("resolver_user_id").references(() => users.id),
    kind: resolutionKindEnum("kind").notNull().default("manual"),
    evidence: metadataColumn("evidence"),
    oracleAdapter: text("oracle_adapter"),
    oracleRef: text("oracle_ref"),
    oraclePayload: jsonb("oracle_payload").$type<Record<string, unknown>>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
  },
  (table) => [unique("resolutions_market_unique").on(table.marketId)],
);
