import { hasQaRunId, isQaMetadata, schema, toReport } from "@habit-gamba/db";
import { inArray } from "drizzle-orm";
import type { InvariantCheckInput, InvariantFailure, InvariantReport } from "@habit-gamba/db";

export async function checkResolutionInvariant(
  input: InvariantCheckInput,
): Promise<InvariantReport> {
  const marketIds = await resolveScopedMarketIds(input);
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
  const contractIds = contracts.map((contract) => contract.id);
  const positions =
    contractIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.positions)
          .where(inArray(schema.positions.contractId, contractIds));
  const resolutions =
    marketIds && marketIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.resolutions)
          .where(marketIds ? inArray(schema.resolutions.marketId, marketIds) : undefined);
  const cancellations =
    marketIds && marketIds.length === 0
      ? []
      : await input.db
          .select()
          .from(schema.cancellations)
          .where(marketIds ? inArray(schema.cancellations.marketId, marketIds) : undefined);
  const failures: InvariantFailure[] = [];
  const contractsByMarketId = groupBy(contracts, (contract) => contract.marketId);
  const positionsByContractId = groupBy(positions, (position) => position.contractId);
  const resolutionsByMarketId = groupBy(resolutions, (resolution) => resolution.marketId);
  const cancellationsByMarketId = groupBy(cancellations, (cancellation) => cancellation.marketId);

  for (const market of markets) {
    const marketContracts = contractsByMarketId.get(market.id) ?? [];
    const hasSettlementState = market.status === "resolved" || market.status === "void";

    if (hasSettlementState) {
      for (const contract of marketContracts) {
        if (contract.shareSupplyMicro !== 0n) {
          failures.push({
            code: "terminal_contract_supply_nonzero",
            entity: { id: contract.id, type: "contract" },
            message: "Terminal market contract has nonzero share supply",
            details: {
              marketId: market.id,
              shareSupplyMicro: contract.shareSupplyMicro,
              status: market.status,
            },
          });
        }

        for (const position of positionsByContractId.get(contract.id) ?? []) {
          if (position.quantityMicro !== 0n) {
            failures.push({
              code: "terminal_position_quantity_nonzero",
              entity: { id: position.id, type: "position" },
              message: "Terminal market position has nonzero quantity",
              details: {
                contractId: contract.id,
                marketId: market.id,
                quantityMicro: position.quantityMicro,
                status: market.status,
              },
            });
          }
        }
      }
    }

    if (market.status === "void") {
      const marketCancellations = cancellationsByMarketId.get(market.id) ?? [];

      if (marketCancellations.length !== 1) {
        failures.push({
          code: "void_market_cancellation_count",
          entity: { id: market.id, type: "market" },
          message: "Void market must have exactly one cancellation row",
          details: { cancellationCount: marketCancellations.length },
        });
      }
    } else if ((cancellationsByMarketId.get(market.id) ?? []).length > 0) {
      failures.push({
        code: "non_void_market_has_cancellation",
        entity: { id: market.id, type: "market" },
        message: "Non-void market has cancellation rows",
        details: {
          cancellationCount: cancellationsByMarketId.get(market.id)?.length ?? 0,
          status: market.status,
        },
      });
    }

    if (market.status !== "resolved" && (resolutionsByMarketId.get(market.id) ?? []).length > 0) {
      failures.push({
        code: "non_resolved_market_has_resolution_settlement",
        entity: { id: market.id, type: "market" },
        message: "Non-resolved market has resolution rows",
        details: {
          resolutionCount: resolutionsByMarketId.get(market.id)?.length ?? 0,
          status: market.status,
        },
      });
    }
  }

  return toReport("resolution", failures);
}

async function resolveScopedMarketIds(input: InvariantCheckInput): Promise<string[] | undefined> {
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

function groupBy<T>(values: T[], getKey: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const value of values) {
    const key = getKey(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }

  return grouped;
}
