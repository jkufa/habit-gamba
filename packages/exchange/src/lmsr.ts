export type LmsrOutcome = "NO" | "YES";

export type LmsrMarketState = {
  liquidityParameterMicro: bigint;
  noSharesMicro: bigint;
  yesSharesMicro: bigint;
};

export type LmsrPrices = {
  no: number;
  yes: number;
};

export type LmsrQuote = {
  costMicro: bigint;
  outcome: LmsrOutcome;
  pricesAfter: LmsrPrices;
  pricesBefore: LmsrPrices;
  sharesMicro: bigint;
};

export function getPrices(marketState: LmsrMarketState): LmsrPrices {
  assertValidState(marketState);

  const yes = Number(marketState.yesSharesMicro);
  const no = Number(marketState.noSharesMicro);
  const b = Number(marketState.liquidityParameterMicro);
  const diff = (yes - no) / b;
  const yesPrice = diff >= 0 ? 1 / (1 + Math.exp(-diff)) : Math.exp(diff) / (1 + Math.exp(diff));

  return {
    no: 1 - yesPrice,
    yes: yesPrice,
  };
}

export function quoteBuy(
  marketState: LmsrMarketState,
  outcome: LmsrOutcome,
  amountMicro: bigint,
): LmsrQuote {
  assertValidState(marketState);
  assertPositiveAmount(amountMicro);

  const sharesMicro = findMaxSharesForBudget(marketState, outcome, amountMicro);
  const costMicro = costDeltaCeil(marketState, applyShares(marketState, outcome, sharesMicro));

  return {
    costMicro,
    outcome,
    pricesAfter: getPrices(applyShares(marketState, outcome, sharesMicro)),
    pricesBefore: getPrices(marketState),
    sharesMicro,
  };
}

export function quoteBuyShares(
  marketState: LmsrMarketState,
  outcome: LmsrOutcome,
  sharesMicro: bigint,
): LmsrQuote {
  assertValidState(marketState);
  assertPositiveAmount(sharesMicro);

  const nextState = applyShares(marketState, outcome, sharesMicro);

  return {
    costMicro: costDeltaCeil(marketState, nextState),
    outcome,
    pricesAfter: getPrices(nextState),
    pricesBefore: getPrices(marketState),
    sharesMicro,
  };
}

export function applyBuy(
  marketState: LmsrMarketState,
  outcome: LmsrOutcome,
  amountMicro: bigint,
): LmsrMarketState {
  const quote = quoteBuy(marketState, outcome, amountMicro);
  return applyShares(marketState, outcome, quote.sharesMicro);
}

function findMaxSharesForBudget(
  marketState: LmsrMarketState,
  outcome: LmsrOutcome,
  amountMicro: bigint,
): bigint {
  let low = 0n;
  let high = amountMicro + 1n;

  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    const costMicro = costDeltaCeil(marketState, applyShares(marketState, outcome, mid));

    if (costMicro <= amountMicro) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

function applyShares(
  marketState: LmsrMarketState,
  outcome: LmsrOutcome,
  sharesMicro: bigint,
): LmsrMarketState {
  assertSafeMicro(sharesMicro, "sharesMicro");

  return outcome === "YES"
    ? {
        ...marketState,
        yesSharesMicro: marketState.yesSharesMicro + sharesMicro,
      }
    : {
        ...marketState,
        noSharesMicro: marketState.noSharesMicro + sharesMicro,
      };
}

function costDeltaCeil(before: LmsrMarketState, after: LmsrMarketState): bigint {
  const delta = costFunctionMicro(after) - costFunctionMicro(before);
  const rounded = Math.ceil(delta - 1e-9);

  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new RangeError("LMSR quote cost is outside safe integer bounds");
  }

  return BigInt(rounded);
}

function costFunctionMicro(marketState: LmsrMarketState): number {
  assertValidState(marketState);

  const b = Number(marketState.liquidityParameterMicro);
  const yes = Number(marketState.yesSharesMicro) / b;
  const no = Number(marketState.noSharesMicro) / b;
  const max = Math.max(yes, no);

  return b * (max + Math.log(Math.exp(yes - max) + Math.exp(no - max)));
}

function assertValidState(marketState: LmsrMarketState) {
  if (marketState.liquidityParameterMicro <= 0n) {
    throw new RangeError("liquidityParameterMicro must be positive");
  }

  if (marketState.yesSharesMicro < 0n || marketState.noSharesMicro < 0n) {
    throw new RangeError("LMSR share supplies must be nonnegative");
  }

  assertSafeMicro(marketState.liquidityParameterMicro, "liquidityParameterMicro");
  assertSafeMicro(marketState.yesSharesMicro, "yesSharesMicro");
  assertSafeMicro(marketState.noSharesMicro, "noSharesMicro");
}

function assertPositiveAmount(amountMicro: bigint) {
  if (amountMicro <= 0n) {
    throw new RangeError("amountMicro must be positive");
  }

  assertSafeMicro(amountMicro, "amountMicro");
}

function assertSafeMicro(value: bigint, name: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds safe LMSR numeric bounds`);
  }
}
