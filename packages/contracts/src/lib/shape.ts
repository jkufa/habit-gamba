import type { MarketContract, MarketWithContracts } from "./types";

export function attachBinaryContracts<TMarket extends Omit<MarketWithContracts, "contracts">>(
  market: TMarket,
  contracts: MarketContract[],
): MarketWithContracts {
  const yesContract = contracts.find((contract) => contract.outcome === "YES");
  const noContract = contracts.find((contract) => contract.outcome === "NO");

  if (!yesContract || !noContract) {
    throw new Error(`Market ${market.id} does not have YES and NO contracts`);
  }

  return {
    ...market,
    contracts: [yesContract, noContract],
  };
}
