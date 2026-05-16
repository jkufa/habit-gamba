import { hasQaRunId, isQaMetadata, schema, toReport } from "@habit-gamba/db";
import type { InvariantCheckInput, InvariantFailure, InvariantReport } from "@habit-gamba/db";
import { inArray } from "drizzle-orm";

export async function checkMarketLifecycleInvariant(
  input: InvariantCheckInput,
): Promise<InvariantReport> {
  const marketIds = await resolveMarketIds(input);
  const markets =
    marketIds && marketIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.markets)
          .where(marketIds ? inArray(schema.markets.id, marketIds) : undefined);
  const contracts =
    marketIds && marketIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.contracts)
          .where(marketIds ? inArray(schema.contracts.marketId, marketIds) : undefined);
  const resolutions =
    marketIds && marketIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.resolutions)
          .where(marketIds ? inArray(schema.resolutions.marketId, marketIds) : undefined);
  const failures: InvariantFailure[] = [];
  const contractsByMarketId = groupBy(contracts, (contract) => contract.marketId);
  const resolutionsByMarketId = groupBy(resolutions, (resolution) => resolution.marketId);
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));

  for (const market of markets) {
    const marketContracts = contractsByMarketId.get(market.id) ?? [];
    const marketResolutions = resolutionsByMarketId.get(market.id) ?? [];

    checkBinaryContracts(market.id, marketContracts, failures);

    if (market.status === "draft") {
      if (market.openedAt || market.closedAt || market.resolvedAt || market.voidedAt) {
        failures.push({
          code: "draft_market_has_terminal_timestamps",
          entity: { id: market.id, type: "market" },
          message: "Draft market has lifecycle timestamps",
        });
      }
      checkNoResolution(market.id, marketResolutions, "draft", failures);
      continue;
    }

    if (market.status === "open") {
      if (!market.openedAt || !market.closesAt || market.closesAt <= market.openedAt) {
        failures.push({
          code: "open_market_invalid_window",
          entity: { id: market.id, type: "market" },
          message: "Open market has missing or invalid open/close window",
          details: { closesAt: market.closesAt, openedAt: market.openedAt },
        });
      }
      if (market.closedAt || market.resolvedAt || market.voidedAt) {
        failures.push({
          code: "open_market_has_terminal_timestamps",
          entity: { id: market.id, type: "market" },
          message: "Open market has terminal timestamps",
        });
      }
      checkNoResolution(market.id, marketResolutions, "open", failures);
      continue;
    }

    if (market.status === "closed") {
      if (!market.openedAt || !market.closesAt || !market.closedAt) {
        failures.push({
          code: "closed_market_missing_timestamps",
          entity: { id: market.id, type: "market" },
          message: "Closed market is missing lifecycle timestamps",
        });
      }
      checkNoResolution(market.id, marketResolutions, "closed", failures);
      continue;
    }

    if (market.status === "resolved") {
      if (!market.resolvedAt) {
        failures.push({
          code: "resolved_market_missing_resolved_at",
          entity: { id: market.id, type: "market" },
          message: "Resolved market has no resolvedAt timestamp",
        });
      }
      if (marketResolutions.length !== 1) {
        failures.push({
          code: "resolved_market_resolution_count",
          entity: { id: market.id, type: "market" },
          message: "Resolved market must have exactly one resolution row",
          details: { resolutionCount: marketResolutions.length },
        });
      }

      const resolution = marketResolutions[0];
      const winningContract = resolution
        ? contractsById.get(resolution.winningContractId)
        : undefined;

      if (resolution && winningContract?.marketId !== market.id) {
        failures.push({
          code: "resolved_market_winning_contract_mismatch",
          entity: { id: resolution.id, type: "resolution" },
          message: "Resolution winning contract is not in resolved market",
          details: { marketId: market.id, winningContractId: resolution.winningContractId },
        });
      }
      continue;
    }

    if (market.status === "void") {
      if (!market.voidedAt) {
        failures.push({
          code: "void_market_missing_voided_at",
          entity: { id: market.id, type: "market" },
          message: "Void market has no voidedAt timestamp",
        });
      }
      checkNoResolution(market.id, marketResolutions, "void", failures);
      continue;
    }

    failures.push({
      code: "market_invalid_status",
      entity: { id: market.id, type: "market" },
      message: "Market has invalid status",
      details: { status: market.status },
    });
  }

  return toReport("market-lifecycle", failures);
}

async function resolveMarketIds(input: InvariantCheckInput): Promise<string[] | undefined> {
  if (input.scope?.marketIds) {
    return input.scope.marketIds;
  }

  const scope = input.scope;

  if (scope?.kind !== "qa") {
    return undefined;
  }

  const markets = await input.db.select().from(schema.markets);

  return markets
    .filter((market) => isQaMetadata(market.metadata) && hasQaRunId(market.metadata, scope.qaRunId))
    .map((market) => market.id);
}

function checkBinaryContracts(
  marketId: string,
  contracts: Array<typeof schema.contracts.$inferSelect>,
  failures: InvariantFailure[],
) {
  const outcomes = contracts.map((contract) => contract.outcome).sort();

  if (contracts.length !== 2 || outcomes[0] !== "NO" || outcomes[1] !== "YES") {
    failures.push({
      code: "market_contract_shape_invalid",
      entity: { id: marketId, type: "market" },
      message: "Market must have exactly YES and NO contracts",
      details: { contractCount: contracts.length, outcomes },
    });
  }
}

function checkNoResolution(
  marketId: string,
  resolutions: Array<typeof schema.resolutions.$inferSelect>,
  status: string,
  failures: InvariantFailure[],
) {
  if (resolutions.length > 0) {
    failures.push({
      code: "non_resolved_market_has_resolution",
      entity: { id: marketId, type: "market" },
      message: "Non-resolved market has resolution rows",
      details: { resolutionCount: resolutions.length, status },
    });
  }
}

function groupBy<T>(values: T[], getKey: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }

  return grouped;
}
