import { REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq, sql } from "drizzle-orm";

import { toBigInt } from "../bigint";
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
        ),
      );

    const ledgerAmountMicro = toBigInt(ledgerTotal?.amountMicro ?? 0n);
    const deltaMicro = balance.availableAmountMicro - ledgerAmountMicro;

    if (deltaMicro !== 0n) {
      mismatches.push({
        cachedAvailableAmountMicro: balance.availableAmountMicro,
        currency: REP_CURRENCY,
        deltaMicro,
        ledgerAmountMicro,
        userId: balance.userId,
      });
    }
  }

  return mismatches.length === 0 ? { ok: true, mismatches: [] } : { ok: false, mismatches };
}
