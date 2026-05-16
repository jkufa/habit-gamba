import { hasQaRunId, isQaMetadata, schema, toReport } from "@habit-gamba/db";
import type { InvariantCheckInput, InvariantFailure, InvariantReport } from "@habit-gamba/db";
import { inArray } from "drizzle-orm";

export async function checkExchangeReferenceInvariant(
  input: InvariantCheckInput,
): Promise<InvariantReport> {
  const scope = await resolveScope(input);
  const [users, markets, contracts, trades, positions] = await Promise.all([
    input.db.select().from(schema.users),
    input.db.select().from(schema.markets),
    input.db.select().from(schema.contracts),
    scope.marketIds && scope.marketIds.length === 0
      ? []
      : input.db
          .select()
          .from(schema.trades)
          .where(scope.marketIds ? inArray(schema.trades.marketId, scope.marketIds) : undefined),
    scope.contractIds && scope.contractIds.length === 0
      ? []
      : input.db
          .select()
          .from(schema.positions)
          .where(
            scope.contractIds ? inArray(schema.positions.contractId, scope.contractIds) : undefined,
          ),
  ]);
  const failures: InvariantFailure[] = [];
  const usersById = new Set(users.map((user) => user.id));
  const marketsById = new Map(markets.map((market) => [market.id, market]));
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]));
  const positionTotalsByContractId = new Map<string, bigint>();

  for (const trade of trades) {
    const market = marketsById.get(trade.marketId);
    const contract = contractsById.get(trade.contractId);

    if (!usersById.has(trade.userId)) {
      failures.push({
        code: "trade_user_missing",
        entity: { id: trade.id, type: "trade" },
        message: "Trade references missing user",
        details: { userId: trade.userId },
      });
    }

    if (!market) {
      failures.push({
        code: "trade_market_missing",
        entity: { id: trade.id, type: "trade" },
        message: "Trade references missing market",
        details: { marketId: trade.marketId },
      });
    }

    if (!contract) {
      failures.push({
        code: "trade_contract_missing",
        entity: { id: trade.id, type: "trade" },
        message: "Trade references missing contract",
        details: { contractId: trade.contractId },
      });
      continue;
    }

    if (contract.marketId !== trade.marketId) {
      failures.push({
        code: "trade_contract_market_mismatch",
        entity: { id: trade.id, type: "trade" },
        message: "Trade contract belongs to different market",
        details: {
          contractId: contract.id,
          contractMarketId: contract.marketId,
          tradeMarketId: trade.marketId,
        },
      });
    }
  }

  for (const position of positions) {
    const contract = contractsById.get(position.contractId);

    if (!usersById.has(position.userId)) {
      failures.push({
        code: "position_user_missing",
        entity: { id: position.id, type: "position" },
        message: "Position references missing user",
        details: { userId: position.userId },
      });
    }

    if (!contract) {
      failures.push({
        code: "position_contract_missing",
        entity: { id: position.id, type: "position" },
        message: "Position references missing contract",
        details: { contractId: position.contractId },
      });
      continue;
    }

    if (position.quantityMicro < 0n) {
      failures.push({
        code: "position_quantity_negative",
        entity: { id: position.id, type: "position" },
        message: "Position quantity is negative",
        details: { quantityMicro: position.quantityMicro },
      });
    }

    positionTotalsByContractId.set(
      position.contractId,
      (positionTotalsByContractId.get(position.contractId) ?? 0n) + position.quantityMicro,
    );
  }

  for (const contract of contracts.filter(
    (contract) => !scope.contractIds || scope.contractIds.includes(contract.id),
  )) {
    const positionTotal = positionTotalsByContractId.get(contract.id) ?? 0n;

    if (contract.shareSupplyMicro !== positionTotal) {
      failures.push({
        code: "contract_supply_position_mismatch",
        entity: { id: contract.id, type: "contract" },
        message: "Contract share supply does not equal summed positions",
        details: {
          positionTotalMicro: positionTotal,
          shareSupplyMicro: contract.shareSupplyMicro,
        },
      });
    }
  }

  return toReport("exchange-reference", failures);
}

async function resolveScope(input: InvariantCheckInput): Promise<{
  contractIds?: string[];
  marketIds?: string[];
}> {
  if (input.scope?.marketIds) {
    const contracts = await input.db
      .select({ id: schema.contracts.id })
      .from(schema.contracts)
      .where(inArray(schema.contracts.marketId, input.scope.marketIds));

    return {
      contractIds: contracts.map((contract) => contract.id),
      marketIds: input.scope.marketIds,
    };
  }

  const scope = input.scope;

  if (scope?.kind !== "qa") {
    return {};
  }

  const markets = await input.db.select().from(schema.markets);
  const marketIds = markets
    .filter((market) => isQaMetadata(market.metadata) && hasQaRunId(market.metadata, scope.qaRunId))
    .map((market) => market.id);
  const contracts =
    marketIds.length === 0
      ? []
      : await input.db
          .select({ id: schema.contracts.id })
          .from(schema.contracts)
          .where(inArray(schema.contracts.marketId, marketIds));

  return {
    contractIds: contracts.map((contract) => contract.id),
    marketIds,
  };
}
