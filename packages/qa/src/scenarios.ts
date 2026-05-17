import { createBinaryMarket, openMarket } from "@habit-gamba/contracts";
import { repToMicro } from "@habit-gamba/db";
import { createExchange } from "@habit-gamba/exchange";
import { cancelMarket, resolveMarket } from "@habit-gamba/resolution";
import type { DbClient } from "@habit-gamba/db";

import type { QaFixture, QaScenarioName } from "./types";

export type QaAction = {
  name: string;
  run: () => Promise<void>;
};

export function buildScenario(input: {
  db: DbClient;
  fixture: QaFixture;
  qaRunId: string;
  scenario: QaScenarioName;
  seed?: number;
  tradeConcurrency?: number;
  trades?: number;
}): QaAction[] {
  if (input.scenario === "happy-path") {
    return buildHappyPath(input);
  }

  if (input.scenario === "cancellation") {
    return buildCancellation(input);
  }

  return buildStress(input);
}

function buildHappyPath(input: { db: DbClient; fixture: QaFixture; qaRunId: string }): QaAction[] {
  const marketIdRef = { current: "" };
  const contractIdRef = { current: "" };
  const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });

  return [
    {
      name: "create-market",
      run: async () => {
        const { market } = await createBinaryMarket({
          creatorUserId: input.fixture.users[0]?.id ?? fail("missing QA creator"),
          db: input.db,
          metadata: qaMarketMetadata(input.qaRunId, "happy-path"),
          slug: `${input.qaRunId}-happy-path`,
          title: "QA happy path market",
        });
        marketIdRef.current = market.id;
        contractIdRef.current = market.contracts[0].id;
      },
    },
    {
      name: "open-market",
      run: async () => {
        await openMarket({
          closesAt: new Date("2030-01-02T00:00:00.000Z"),
          db: input.db,
          marketId: marketIdRef.current,
          openedAt: new Date("2030-01-01T00:00:00.000Z"),
        });
      },
    },
    {
      name: "buy-yes-and-no",
      run: async () => {
        await exchange.buy({
          amountMicro: repToMicro(5n),
          contractId: contractIdRef.current,
          db: input.db,
          idempotencyKey: `${input.qaRunId}:happy-path:buy-yes`,
          now: new Date("2030-01-01T00:00:01.000Z"),
          outcome: "YES",
          userId: input.fixture.users[1]?.id ?? fail("missing QA bettor"),
        });
        await exchange.buy({
          amountMicro: repToMicro(3n),
          contractId: contractIdRef.current,
          db: input.db,
          idempotencyKey: `${input.qaRunId}:happy-path:buy-no`,
          now: new Date("2030-01-01T00:00:02.000Z"),
          outcome: "NO",
          userId: input.fixture.users[2]?.id ?? fail("missing QA bettor"),
        });
      },
    },
    {
      name: "resolve-market",
      run: async () => {
        await resolveMarket({
          db: input.db,
          marketId: marketIdRef.current,
          outcome: "YES",
          resolvedAt: new Date("2030-01-02T00:00:01.000Z"),
          resolvedByUserId: input.fixture.users[0]?.id ?? fail("missing QA resolver"),
        });
      },
    },
  ];
}

function buildCancellation(input: {
  db: DbClient;
  fixture: QaFixture;
  qaRunId: string;
}): QaAction[] {
  const marketIdRef = { current: "" };
  const contractIdRef = { current: "" };
  const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });

  return [
    {
      name: "create-market",
      run: async () => {
        const { market } = await createBinaryMarket({
          creatorUserId: input.fixture.users[0]?.id ?? fail("missing QA creator"),
          db: input.db,
          metadata: qaMarketMetadata(input.qaRunId, "cancellation"),
          slug: `${input.qaRunId}-cancellation`,
          title: "QA cancellation market",
        });
        marketIdRef.current = market.id;
        contractIdRef.current = market.contracts[0].id;
      },
    },
    {
      name: "open-market",
      run: async () => {
        await openMarket({
          closesAt: new Date("2030-02-02T00:00:00.000Z"),
          db: input.db,
          marketId: marketIdRef.current,
          openedAt: new Date("2030-02-01T00:00:00.000Z"),
        });
      },
    },
    {
      name: "buy-before-cancel",
      run: async () => {
        await exchange.buy({
          amountMicro: repToMicro(4n),
          contractId: contractIdRef.current,
          db: input.db,
          idempotencyKey: `${input.qaRunId}:cancellation:buy-yes`,
          now: new Date("2030-02-01T00:00:01.000Z"),
          outcome: "YES",
          userId: input.fixture.users[1]?.id ?? fail("missing QA bettor"),
        });
        await exchange.buy({
          amountMicro: repToMicro(2n),
          contractId: contractIdRef.current,
          db: input.db,
          idempotencyKey: `${input.qaRunId}:cancellation:buy-no`,
          now: new Date("2030-02-01T00:00:02.000Z"),
          outcome: "NO",
          userId: input.fixture.users[2]?.id ?? fail("missing QA bettor"),
        });
      },
    },
    {
      name: "cancel-market",
      run: async () => {
        await cancelMarket({
          cancelledAt: new Date("2030-02-01T00:00:03.000Z"),
          creatorPenaltyBps: 1000,
          db: input.db,
          marketId: marketIdRef.current,
          reason: "qa cancellation scenario",
        });
      },
    },
  ];
}

function buildStress(input: {
  db: DbClient;
  fixture: QaFixture;
  qaRunId: string;
  seed?: number;
  tradeConcurrency?: number;
  trades?: number;
}): QaAction[] {
  if (input.trades !== undefined && input.trades > 0) {
    return buildTradeStress(input);
  }

  const actions: QaAction[] = [];
  const random = mulberry32(input.seed ?? 1);

  for (let index = 0; index < 25; index += 1) {
    const scenario = random() < 0.4 ? "cancellation" : "happy-path";
    const marketIdRef = { current: "" };
    const contractIdRef = { current: "" };

    actions.push({
      name: `stress-${index}-create-market`,
      run: async () => {
        const { market } = await createBinaryMarket({
          creatorUserId:
            input.fixture.users[index % input.fixture.users.length]?.id ?? fail("missing QA user"),
          db: input.db,
          metadata: qaMarketMetadata(input.qaRunId, `stress-${scenario}`),
          slug: `${input.qaRunId}-stress-${index}`,
          title: `QA stress market ${index}`,
        });
        marketIdRef.current = market.id;
        contractIdRef.current = market.contracts[0].id;
      },
    });
    actions.push({
      name: `stress-${index}-open-market`,
      run: async () => {
        await openMarket({
          closesAt: new Date(`2030-03-${String((index % 20) + 2).padStart(2, "0")}T00:00:00.000Z`),
          db: input.db,
          marketId: marketIdRef.current,
          openedAt: new Date(`2030-03-${String((index % 20) + 1).padStart(2, "0")}T00:00:00.000Z`),
        });
      },
    });

    if (scenario === "cancellation") {
      actions.push({
        name: `stress-${index}-buy-before-cancel`,
        run: async () => {
          const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });
          await exchange.buy({
            amountMicro: repToMicro(1n),
            contractId: contractIdRef.current,
            db: input.db,
            idempotencyKey: `${input.qaRunId}:stress:${index}:buy-cancel`,
            now: new Date(`2030-03-${String((index % 20) + 1).padStart(2, "0")}T00:00:01.000Z`),
            outcome: "NO",
            userId:
              input.fixture.users[(index + 1) % input.fixture.users.length]?.id ??
              fail("missing QA user"),
          });
        },
      });
      actions.push({
        name: `stress-${index}-cancel-market`,
        run: async () => {
          await cancelMarket({
            creatorPenaltyBps: 1000,
            db: input.db,
            marketId: marketIdRef.current,
            reason: `qa stress cancellation ${index}`,
          });
        },
      });
    } else {
      actions.push({
        name: `stress-${index}-buy-before-resolve`,
        run: async () => {
          const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });
          await exchange.buy({
            amountMicro: repToMicro(1n),
            contractId: contractIdRef.current,
            db: input.db,
            idempotencyKey: `${input.qaRunId}:stress:${index}:buy-resolve`,
            now: new Date(`2030-03-${String((index % 20) + 1).padStart(2, "0")}T00:00:01.000Z`),
            outcome: "YES",
            userId:
              input.fixture.users[(index + 1) % input.fixture.users.length]?.id ??
              fail("missing QA user"),
          });
        },
      });
      actions.push({
        name: `stress-${index}-resolve-market`,
        run: async () => {
          await resolveMarket({
            db: input.db,
            marketId: marketIdRef.current,
            outcome: "YES",
            resolvedByUserId:
              input.fixture.users[index % input.fixture.users.length]?.id ??
              fail("missing QA resolver"),
          });
        },
      });
    }
  }

  return actions;
}

function buildTradeStress(input: {
  db: DbClient;
  fixture: QaFixture;
  qaRunId: string;
  seed?: number;
  tradeConcurrency?: number;
  trades?: number;
}): QaAction[] {
  const marketIdRef = { current: "" };
  const contractIdRef = { current: "" };
  const exchange = createExchange({ defaultLiquidityMicro: repToMicro(100n) });
  const tradeCount = input.trades ?? 0;
  const tradeConcurrency = input.tradeConcurrency ?? 8;

  return [
    {
      name: "trade-stress-create-market",
      run: async () => {
        const { market } = await createBinaryMarket({
          creatorUserId: input.fixture.users[0]?.id ?? fail("missing QA creator"),
          db: input.db,
          metadata: qaMarketMetadata(input.qaRunId, "trade-stress"),
          slug: `${input.qaRunId}-trade-stress`,
          title: "QA trade stress market",
        });

        marketIdRef.current = market.id;
        contractIdRef.current = market.contracts[0].id;
      },
    },
    {
      name: "trade-stress-open-market",
      run: async () => {
        await openMarket({
          closesAt: new Date("2030-04-02T00:00:00.000Z"),
          db: input.db,
          marketId: marketIdRef.current,
          openedAt: new Date("2030-04-01T00:00:00.000Z"),
        });
      },
    },
    {
      name: `trade-stress-buy-${tradeCount}`,
      run: async () => {
        const random = mulberry32(input.seed ?? 1);
        const actions = Array.from({ length: tradeCount }, (_, index) => {
          const user =
            input.fixture.users[index % input.fixture.users.length] ?? fail("missing QA user");
          const outcome = random() < 0.5 ? "YES" : "NO";
          const amountMicro = repToMicro(BigInt(1 + Math.floor(random() * 3)));

          return async () => {
            await exchange.buy({
              amountMicro,
              contractId: contractIdRef.current,
              db: input.db,
              idempotencyKey: `${input.qaRunId}:trade-stress:${index}`,
              now: new Date("2030-04-01T00:00:01.000Z"),
              outcome,
              userId: user.id,
            });
          };
        });

        await runBounded(actions, tradeConcurrency);
      },
    },
    {
      name: "trade-stress-resolve-market",
      run: async () => {
        await resolveMarket({
          db: input.db,
          marketId: marketIdRef.current,
          outcome: "YES",
          resolvedAt: new Date("2030-04-02T00:00:01.000Z"),
          resolvedByUserId: input.fixture.users[0]?.id ?? fail("missing QA resolver"),
        });
      },
    },
  ];
}

function qaMarketMetadata(qaRunId: string, scenario: string): Record<string, unknown> {
  return {
    qa: true,
    qaRunId,
    scenario,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed;

  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fail(message: string): never {
  throw new Error(message);
}

async function runBounded(tasks: Array<() => Promise<void>>, concurrency: number) {
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex];
        nextIndex += 1;
        await task?.();
      }
    }),
  );
}
