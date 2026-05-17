import { checkMarketLifecycleInvariant } from "@habit-gamba/contracts";
import { checkGlobalDatabaseInvariant } from "@habit-gamba/db";
import { checkExchangeReferenceInvariant } from "@habit-gamba/exchange";
import { checkResolutionInvariant } from "@habit-gamba/resolution";
import { checkWalletInvariant } from "@habit-gamba/wallet";
import type { InvariantCheck } from "@habit-gamba/db";

export const defaultInvariantChecks: InvariantCheck[] = [
  checkWalletInvariant,
  checkMarketLifecycleInvariant,
  checkExchangeReferenceInvariant,
  checkResolutionInvariant,
  checkGlobalDatabaseInvariant,
];
