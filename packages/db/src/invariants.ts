import type { DbClient } from "./client";
import * as schema from "./schema";

export type InvariantScope =
  | {
      kind: "all";
      marketIds?: string[];
      userIds?: string[];
    }
  | {
      kind: "qa";
      marketIds?: string[];
      qaRunId?: string;
      userIds?: string[];
    };

export type InvariantFailure = {
  code: string;
  message: string;
  entity?: {
    id: string;
    type: string;
  };
  details?: Record<string, unknown>;
};

export type InvariantReport = {
  failures: InvariantFailure[];
  name: string;
  ok: boolean;
};

export type InvariantCheckInput = {
  db: DbClient;
  scope?: InvariantScope;
};

export type InvariantCheck = (input: InvariantCheckInput) => Promise<InvariantReport>;

export async function checkGlobalDatabaseInvariant(
  input: InvariantCheckInput,
): Promise<InvariantReport> {
  const failures: InvariantFailure[] = [];
  const marketIds = await resolveMarketIds(input);
  const markets = await input.db.select().from(schema.markets);
  const contracts = await input.db.select().from(schema.contracts);
  const trades = await input.db.select().from(schema.trades);
  const positions = await input.db.select().from(schema.positions);
  const marketsById = new Map(markets.map((market) => [market.id, market]));
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const scopedMarketIds = marketIds ? new Set(marketIds) : undefined;
  const scopedContractIds = new Set(
    contracts
      .filter((contract) => !scopedMarketIds || scopedMarketIds.has(contract.marketId))
      .map((contract) => contract.id),
  );
  const scopedTrades = trades.filter(
    (trade) =>
      !scopedMarketIds ||
      scopedMarketIds.has(trade.marketId) ||
      scopedContractIds.has(trade.contractId),
  );
  const scopedPositions = positions.filter((position) =>
    scopedContractIds.has(position.contractId),
  );

  for (const trade of scopedTrades) {
    const market = marketsById.get(trade.marketId);

    if (!market) {
      continue;
    }

    if (market.status === "resolved" || market.status === "void") {
      failures.push({
        code: "terminal_market_has_trade",
        entity: { id: trade.id, type: "trade" },
        message: "Terminal market has trade rows",
        details: { marketId: market.id, status: market.status },
      });
    }
  }

  for (const position of scopedPositions) {
    const contract = contractsById.get(position.contractId);
    const market = contract ? marketsById.get(contract.marketId) : undefined;

    if (market?.status === "void") {
      failures.push({
        code: "void_market_has_position",
        entity: { id: position.id, type: "position" },
        message: "Void market has position rows before refund semantics exist",
        details: { contractId: position.contractId, marketId: market.id },
      });
    }
  }

  return toReport("global-database", failures);
}

export function toReport(name: string, failures: InvariantFailure[]): InvariantReport {
  return {
    failures,
    name,
    ok: failures.length === 0,
  };
}

export function isQaMetadata(value: Record<string, unknown>): boolean {
  return value.qa === true;
}

export function hasQaRunId(value: Record<string, unknown>, qaRunId: string | undefined): boolean {
  return qaRunId === undefined || value.qaRunId === qaRunId;
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
