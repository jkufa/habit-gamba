import { REP_CURRENCY, schema, toReport } from "@habit-gamba/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { toBigInt } from "../bigint";
import type { InvariantCheckInput, InvariantFailure, InvariantReport } from "@habit-gamba/db";
import type { RepLedgerInvariantMismatch, RepLedgerInvariantReport, WalletDbInput } from "../types";

export async function checkRepLedgerInvariant(
  input: WalletDbInput & {
    userId?: string;
  },
): Promise<RepLedgerInvariantReport> {
  const whereUser = input.userId ? eq(schema.balances.userId, input.userId) : undefined;
  const balanceRows = await input.db
    .select()
    .from(schema.balances)
    .where(
      whereUser
        ? and(eq(schema.balances.currency, REP_CURRENCY), whereUser)
        : eq(schema.balances.currency, REP_CURRENCY),
    );

  const mismatches: RepLedgerInvariantMismatch[] = [];

  for (const balance of balanceRows) {
    const [ledgerTotal] = await input.db
      .select({
        amountMicro: sql<bigint>`coalesce(sum(${schema.ledgerEntries.amountDeltaMicro}), 0)`,
      })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.userId, balance.userId),
          eq(schema.ledgerEntries.currency, REP_CURRENCY),
          sql`${schema.ledgerEntries.communityId} is not distinct from ${balance.communityId}`,
        ),
      );

    const ledgerAmountMicro = toBigInt(ledgerTotal?.amountMicro ?? 0n);
    const deltaMicro = balance.availableAmountMicro - ledgerAmountMicro;

    if (deltaMicro !== 0n) {
      mismatches.push({
        cachedAvailableAmountMicro: balance.availableAmountMicro,
        communityId: balance.communityId,
        currency: REP_CURRENCY,
        deltaMicro,
        ledgerAmountMicro,
        userId: balance.userId,
      });
    }
  }

  return mismatches.length === 0 ? { ok: true, mismatches: [] } : { ok: false, mismatches };
}

export async function checkWalletInvariant(input: InvariantCheckInput): Promise<InvariantReport> {
  const userIds = await resolveUserIds(input);
  const failures: InvariantFailure[] = [];
  const balanceRows =
    userIds && userIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.balances)
          .where(
            and(
              eq(schema.balances.currency, REP_CURRENCY),
              userIds ? inArray(schema.balances.userId, userIds) : undefined,
            ),
          );
  const ledgerRows =
    userIds && userIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.ledgerEntries)
          .where(
            and(
              eq(schema.ledgerEntries.currency, REP_CURRENCY),
              userIds ? inArray(schema.ledgerEntries.userId, userIds) : undefined,
            ),
          );
  const balancesByKey = new Map(balanceRows.map((balance) => [balanceKey(balance), balance]));
  const ledgerTotalsByUserId = new Map<string, bigint>();
  const idempotencyOwners = new Map<string, string>();
  const sourceOwners = new Map<string, string>();

  for (const ledgerEntry of ledgerRows) {
    ledgerTotalsByUserId.set(
      ledgerKey(ledgerEntry),
      (ledgerTotalsByUserId.get(ledgerKey(ledgerEntry)) ?? 0n) + ledgerEntry.amountDeltaMicro,
    );

    pushDuplicateFailure({
      code: "duplicate_ledger_idempotency_key",
      entityId: ledgerEntry.id,
      failures,
      key: ledgerEntry.idempotencyKey,
      message: "Ledger idempotency key is not unique",
      owners: idempotencyOwners,
    });
    pushDuplicateFailure({
      code: "duplicate_ledger_source",
      entityId: ledgerEntry.id,
      failures,
      key: `${ledgerEntry.sourceType}:${ledgerEntry.sourceId}:${ledgerEntry.userId}:${ledgerEntry.communityId}`,
      message: "Ledger source tuple is not unique",
      owners: sourceOwners,
    });
  }

  for (const balance of balanceRows) {
    const ledgerAmountMicro = ledgerTotalsByUserId.get(balanceKey(balance)) ?? 0n;
    const deltaMicro = balance.availableAmountMicro - ledgerAmountMicro;

    if (deltaMicro !== 0n) {
      failures.push({
        code: "wallet_cached_balance_mismatch",
        entity: { id: balance.id, type: "balance" },
        message: "Cached available balance does not equal ledger sum",
        details: {
          cachedAvailableAmountMicro: balance.availableAmountMicro,
          communityId: balance.communityId,
          deltaMicro,
          ledgerAmountMicro,
          userId: balance.userId,
        },
      });
    }

    if (balance.lockedAmountMicro < 0n) {
      failures.push({
        code: "wallet_locked_negative",
        entity: { id: balance.id, type: "balance" },
        message: "Locked amount is negative",
        details: { lockedAmountMicro: balance.lockedAmountMicro, userId: balance.userId },
      });
    }

    if (balance.availableAmountMicro < -balance.creditLimitMicro) {
      failures.push({
        code: "wallet_available_below_credit_limit",
        entity: { id: balance.id, type: "balance" },
        message: "Available amount is below negative credit limit",
        details: {
          availableAmountMicro: balance.availableAmountMicro,
          creditLimitMicro: balance.creditLimitMicro,
          userId: balance.userId,
        },
      });
    }
  }

  for (const [key, ledgerAmountMicro] of ledgerTotalsByUserId) {
    if (!balancesByKey.has(key) && ledgerAmountMicro !== 0n) {
      const [userId = "unknown", communityId = "unknown"] = key.split(":");
      failures.push({
        code: "wallet_ledger_without_balance",
        entity: { id: userId, type: "user" },
        message: "Ledger entries exist for user without cached balance row",
        details: { communityId, ledgerAmountMicro, userId },
      });
    }
  }

  return toReport("wallet", failures);
}

function balanceKey(balance: typeof schema.balances.$inferSelect): string {
  return `${balance.userId}:${balance.communityId}`;
}

function ledgerKey(ledgerEntry: typeof schema.ledgerEntries.$inferSelect): string {
  return `${ledgerEntry.userId}:${ledgerEntry.communityId}`;
}

async function resolveUserIds(input: InvariantCheckInput): Promise<string[] | undefined> {
  if (input.scope?.userIds) {
    return input.scope.userIds;
  }

  if (input.scope?.kind !== "qa") {
    return undefined;
  }

  const users = await input.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.provider, "qa"));

  return users.map((user) => user.id);
}

function pushDuplicateFailure(input: {
  code: string;
  entityId: string;
  failures: InvariantFailure[];
  key: string;
  message: string;
  owners: Map<string, string>;
}) {
  const existingOwner = input.owners.get(input.key);

  if (existingOwner) {
    input.failures.push({
      code: input.code,
      entity: { id: input.entityId, type: "ledger_entry" },
      message: input.message,
      details: { existingLedgerEntryId: existingOwner, key: input.key },
    });
    return;
  }

  input.owners.set(input.key, input.entityId);
}
