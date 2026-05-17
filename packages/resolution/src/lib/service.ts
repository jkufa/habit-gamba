import { createId, schema } from "@habit-gamba/db";
import { payoutRep, penalizeRep, refundRep } from "@habit-gamba/wallet";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import {
  BPS_DENOMINATOR,
  CANCELLATION_PENALTY_SOURCE_TYPE,
  CANCELLATION_REFUND_SOURCE_TYPE,
  DEFAULT_AUTO_CANCEL_LIMIT,
  DEFAULT_CREATOR_PENALTY_BPS,
  RESOLUTION_PAYOUT_SOURCE_TYPE,
} from "./constants";
import {
  ResolutionConfigError,
  ResolutionIdempotencyConflictError,
  ResolutionInvalidTransitionError,
  ResolutionMarketNotFoundError,
} from "./errors";
import type {
  AutoCancelExpiredMarketsInput,
  AutoCancelExpiredMarketsResult,
  CancelMarketInput,
  CancelMarketResult,
  DbTransaction,
  LedgerEntry,
  Market,
  MarketContract,
  Position,
  PreviewCancelMarketInput,
  PreviewCancelMarketResult,
  ResolutionConfig,
  ResolutionExecutor,
  ResolutionOutcome,
  ResolveMarketInput,
  ResolveMarketResult,
} from "./types";

export async function resolveMarket(input: ResolveMarketInput): Promise<ResolveMarketResult> {
  return input.db.transaction(async (tx) => {
    const loaded = await loadMarketForUpdate(tx, input.marketId);

    if (loaded.market.status === "resolved") {
      return getIdempotentResolutionResult(tx, loaded.market, input);
    }

    assertCanResolve(loaded.market);

    const winningContract = getContractByOutcome(loaded.contracts, input.outcome);
    const resolvedAt = input.resolvedAt ?? new Date();
    const resolutionId = createId();
    const positions = await loadPositionsForUpdate(tx, loaded.contracts);
    const ledgerEntries: LedgerEntry[] = [];

    for (const position of positions
      .filter(
        (candidate) => candidate.contractId === winningContract.id && candidate.quantityMicro > 0n,
      )
      .sort((left, right) => left.userId.localeCompare(right.userId))) {
      const result = await payoutRep({
        amountMicro: position.quantityMicro,
        db: input.db,
        idempotencyKey: `resolve:${input.marketId}:payout:${position.userId}`,
        metadata: {
          marketId: input.marketId,
          positionId: position.id,
          resolvedByUserId: input.resolvedByUserId,
          winningContractId: winningContract.id,
        },
        sourceId: resolutionId,
        sourceType: RESOLUTION_PAYOUT_SOURCE_TYPE,
        tx,
        userId: position.userId,
      });
      ledgerEntries.push(result.ledgerEntry);
    }

    await closePositionsAndContracts(tx, loaded.contracts, resolvedAt);

    const [resolution] = await tx
      .insert(schema.resolutions)
      .values({
        evidence: input.evidence ?? {},
        id: resolutionId,
        marketId: input.marketId,
        resolvedAt,
        resolverUserId: input.resolvedByUserId,
        winningContractId: winningContract.id,
      })
      .returning();

    if (!resolution) {
      throw new Error("Failed to create resolution");
    }

    const [market] = await tx
      .update(schema.markets)
      .set({
        resolvedAt,
        status: "resolved",
        updatedAt: new Date(),
      })
      .where(eq(schema.markets.id, input.marketId))
      .returning();

    if (!market) {
      throw new Error("Failed to mark market resolved");
    }

    return {
      idempotent: false,
      ledgerEntries,
      market,
      resolution,
    };
  });
}

export async function cancelMarket(input: CancelMarketInput): Promise<CancelMarketResult> {
  const reason = input.reason.trim();

  if (reason.length === 0) {
    throw new RangeError("reason must be nonempty");
  }

  return input.db.transaction(async (tx) => {
    const loaded = await loadMarketForUpdate(tx, input.marketId);

    if (loaded.market.status === "void") {
      return getIdempotentCancellationResult(tx, loaded.market, reason);
    }

    assertCanCancel(loaded.market);

    const cancelledAt = input.cancelledAt ?? new Date();
    const cancellationId = createId();
    const refundRows = await loadRefundRows(tx, input.marketId);
    const refundTotalMicro = refundRows.reduce((sum, row) => sum + row.amountMicro, 0n);
    const creatorPenaltyMicro = calculatePenalty(refundTotalMicro, normalizePenaltyBps(input));
    const ledgerEntries: LedgerEntry[] = [];

    for (const refund of refundRows) {
      const result = await refundRep({
        amountMicro: refund.amountMicro,
        db: input.db,
        idempotencyKey: `cancel:${input.marketId}:refund:${refund.userId}`,
        metadata: {
          cancellationReason: reason,
          marketId: input.marketId,
        },
        sourceId: cancellationId,
        sourceType: CANCELLATION_REFUND_SOURCE_TYPE,
        tx,
        userId: refund.userId,
      });
      ledgerEntries.push(result.ledgerEntry);
    }

    if (creatorPenaltyMicro > 0n) {
      const result = await penalizeRep({
        amountMicro: creatorPenaltyMicro,
        db: input.db,
        idempotencyKey: `cancel:${input.marketId}:creator-penalty`,
        metadata: {
          cancellationReason: reason,
          marketId: input.marketId,
          penaltyBps: normalizePenaltyBps(input),
          refundTotalMicro: refundTotalMicro.toString(),
        },
        sourceId: cancellationId,
        sourceType: CANCELLATION_PENALTY_SOURCE_TYPE,
        tx,
        userId: loaded.market.creatorUserId,
      });
      ledgerEntries.push(result.ledgerEntry);
    }

    await closePositionsAndContracts(tx, loaded.contracts, cancelledAt);

    const [cancellation] = await tx
      .insert(schema.cancellations)
      .values({
        cancelledAt,
        creatorPenaltyMicro,
        id: cancellationId,
        marketId: input.marketId,
        reason,
        refundTotalMicro,
      })
      .returning();

    if (!cancellation) {
      throw new Error("Failed to create cancellation");
    }

    const [market] = await tx
      .update(schema.markets)
      .set({
        status: "void",
        updatedAt: new Date(),
        voidedAt: cancelledAt,
      })
      .where(eq(schema.markets.id, input.marketId))
      .returning();

    if (!market) {
      throw new Error("Failed to mark market cancelled");
    }

    return {
      cancellation,
      idempotent: false,
      ledgerEntries,
      market,
    };
  });
}

export async function previewCancelMarket(
  input: PreviewCancelMarketInput,
): Promise<PreviewCancelMarketResult> {
  const refundRows = await loadRefundRows(input.db, input.marketId);
  const refundTotalMicro = refundRows.reduce((sum, row) => sum + row.amountMicro, 0n);
  const creatorRefundMicro =
    refundRows.find((row) => row.userId === row.marketCreatorUserId)?.amountMicro ?? 0n;
  const creatorPenaltyMicro = calculatePenalty(refundTotalMicro, normalizePenaltyBps(input));

  return {
    creatorNetMicro: creatorRefundMicro - creatorPenaltyMicro,
    creatorPenaltyMicro,
    refundTotalMicro,
  };
}

export async function autoCancelExpiredMarkets(
  input: AutoCancelExpiredMarketsInput,
): Promise<AutoCancelExpiredMarketsResult> {
  const limit = normalizeLimit(input.limit);
  const expiredMarkets = await input.db
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(and(eq(schema.markets.status, "open"), lte(schema.markets.closesAt, input.now)))
    .orderBy(asc(schema.markets.closesAt), asc(schema.markets.id))
    .limit(limit);
  const cancelledMarketIds: string[] = [];
  const errors: AutoCancelExpiredMarketsResult["errors"] = [];

  for (const market of expiredMarkets) {
    try {
      const result = await cancelMarket({
        cancelledAt: input.now,
        db: input.db,
        marketId: market.id,
        reason: input.reason ?? "expired",
        ...(input.creatorPenaltyBps === undefined
          ? {}
          : { creatorPenaltyBps: input.creatorPenaltyBps }),
      });
      cancelledMarketIds.push(result.market.id);
    } catch (error) {
      errors.push({
        marketId: market.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    cancelledCount: cancelledMarketIds.length,
    cancelledMarketIds,
    errors,
  };
}

async function getIdempotentResolutionResult(
  tx: DbTransaction,
  market: Market,
  input: ResolveMarketInput,
): Promise<ResolveMarketResult> {
  const [resolution] = await tx
    .select()
    .from(schema.resolutions)
    .where(eq(schema.resolutions.marketId, market.id))
    .limit(1);

  if (!resolution) {
    throw new Error("Resolved market is missing resolution row");
  }

  const [winningContract] = await tx
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.id, resolution.winningContractId))
    .limit(1);

  if (winningContract?.outcome !== input.outcome) {
    throw new ResolutionIdempotencyConflictError({ marketId: market.id });
  }

  return {
    idempotent: true,
    ledgerEntries: await loadLedgerEntries(tx, RESOLUTION_PAYOUT_SOURCE_TYPE, resolution.id),
    market,
    resolution,
  };
}

async function getIdempotentCancellationResult(
  tx: DbTransaction,
  market: Market,
  reason: string,
): Promise<CancelMarketResult> {
  const [cancellation] = await tx
    .select()
    .from(schema.cancellations)
    .where(eq(schema.cancellations.marketId, market.id))
    .limit(1);

  if (!cancellation) {
    throw new Error("Cancelled market is missing cancellation row");
  }

  if (cancellation.reason !== reason) {
    throw new ResolutionIdempotencyConflictError({ marketId: market.id });
  }

  return {
    cancellation,
    idempotent: true,
    ledgerEntries: [
      ...(await loadLedgerEntries(tx, CANCELLATION_REFUND_SOURCE_TYPE, cancellation.id)),
      ...(await loadLedgerEntries(tx, CANCELLATION_PENALTY_SOURCE_TYPE, cancellation.id)),
    ],
    market,
  };
}

async function loadMarketForUpdate(
  tx: DbTransaction,
  marketId: string,
): Promise<{ contracts: [MarketContract, MarketContract]; market: Market }> {
  const [market] = await tx
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .for("update")
    .limit(1);

  if (!market) {
    throw new ResolutionMarketNotFoundError({ marketId });
  }

  const contracts = await tx
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.marketId, market.id))
    .orderBy(schema.contracts.outcome)
    .for("update");

  return {
    contracts: attachBinaryContracts(market.id, contracts),
    market,
  };
}

async function loadPositionsForUpdate(
  tx: DbTransaction,
  contracts: [MarketContract, MarketContract],
): Promise<Position[]> {
  return tx
    .select()
    .from(schema.positions)
    .where(
      inArray(
        schema.positions.contractId,
        contracts.map((contract) => contract.id),
      ),
    )
    .orderBy(asc(schema.positions.userId), asc(schema.positions.contractId))
    .for("update");
}

async function loadRefundRows(
  tx: ResolutionExecutor,
  marketId: string,
): Promise<Array<{ amountMicro: bigint; marketCreatorUserId: string; userId: string }>> {
  const rows = await tx
    .select({
      amountMicro: sql<bigint>`coalesce(sum(-${schema.trades.cashDeltaMicro}), 0)`,
      marketCreatorUserId: schema.markets.creatorUserId,
      userId: schema.trades.userId,
    })
    .from(schema.trades)
    .innerJoin(schema.markets, eq(schema.markets.id, schema.trades.marketId))
    .where(and(eq(schema.trades.marketId, marketId), eq(schema.trades.side, "buy")))
    .groupBy(schema.trades.userId, schema.markets.creatorUserId)
    .orderBy(asc(schema.trades.userId));

  return rows
    .map((row) => ({
      amountMicro: BigInt(row.amountMicro),
      marketCreatorUserId: row.marketCreatorUserId,
      userId: row.userId,
    }))
    .filter((row) => row.amountMicro > 0n);
}

async function closePositionsAndContracts(
  tx: DbTransaction,
  contracts: [MarketContract, MarketContract],
  now: Date,
) {
  const contractIds = contracts.map((contract) => contract.id);

  await tx
    .update(schema.positions)
    .set({
      quantityMicro: 0n,
      updatedAt: now,
    })
    .where(inArray(schema.positions.contractId, contractIds));

  await tx
    .update(schema.contracts)
    .set({
      shareSupplyMicro: 0n,
      updatedAt: now,
    })
    .where(inArray(schema.contracts.id, contractIds));
}

async function loadLedgerEntries(
  tx: DbTransaction,
  sourceType: string,
  sourceId: string,
): Promise<LedgerEntry[]> {
  return tx
    .select()
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.sourceType, sourceType),
        eq(schema.ledgerEntries.sourceId, sourceId),
      ),
    )
    .orderBy(asc(schema.ledgerEntries.userId), asc(schema.ledgerEntries.id));
}

function assertCanResolve(market: Market) {
  if (market.status !== "open" && market.status !== "closed") {
    throw new ResolutionInvalidTransitionError({
      fromStatus: market.status,
      marketId: market.id,
      toStatus: "resolved",
    });
  }
}

function assertCanCancel(market: Market) {
  if (market.status === "resolved" || market.status === "void") {
    throw new ResolutionInvalidTransitionError({
      fromStatus: market.status,
      marketId: market.id,
      toStatus: "void",
    });
  }
}

function attachBinaryContracts(
  marketId: string,
  contracts: MarketContract[],
): [MarketContract, MarketContract] {
  const yesContract = contracts.find((contract) => contract.outcome === "YES");
  const noContract = contracts.find((contract) => contract.outcome === "NO");

  if (!yesContract || !noContract || contracts.length !== 2) {
    throw new Error(`Market ${marketId} does not have YES and NO contracts`);
  }

  return [yesContract, noContract];
}

function getContractByOutcome(
  contracts: [MarketContract, MarketContract],
  outcome: ResolutionOutcome,
): MarketContract {
  const contract = contracts.find((candidate) => candidate.outcome === outcome);

  if (!contract) {
    throw new Error(`Missing ${outcome} contract`);
  }

  return contract;
}

function normalizePenaltyBps(input: ResolutionConfig): number {
  const penaltyBps = input.creatorPenaltyBps ?? DEFAULT_CREATOR_PENALTY_BPS;

  if (!Number.isInteger(penaltyBps) || penaltyBps < 0 || penaltyBps > 10_000) {
    throw new ResolutionConfigError("creatorPenaltyBps must be an integer between 0 and 10000");
  }

  return penaltyBps;
}

function calculatePenalty(refundTotalMicro: bigint, penaltyBps: number): bigint {
  return (refundTotalMicro * BigInt(penaltyBps)) / BPS_DENOMINATOR;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_AUTO_CANCEL_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("limit must be a positive integer");
  }

  return limit;
}
