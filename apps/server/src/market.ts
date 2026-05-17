import type { ExchangeMarketView } from "@habit-gamba/exchange";
import type { MarketWithContracts } from "@habit-gamba/contracts";

export function findContractIdForOutcome(
  market: Pick<MarketWithContracts | ExchangeMarketView, "contracts">,
  outcome: "NO" | "YES",
): string {
  const contract = market.contracts.find((candidate) => candidate.outcome === outcome);

  if (!contract) {
    throw new Error(`Market is missing ${outcome} contract`);
  }

  return contract.id;
}
