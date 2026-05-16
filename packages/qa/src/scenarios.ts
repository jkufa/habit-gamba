import { closeMarket, createBinaryMarket, openMarket, voidMarket } from "@habit-gamba/contracts";
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
      name: "close-market",
      run: async () => {
        await closeMarket({
          closedAt: new Date("2030-01-02T00:00:01.000Z"),
          db: input.db,
          marketId: marketIdRef.current,
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
      name: "void-market",
      run: async () => {
        await voidMarket({
          db: input.db,
          marketId: marketIdRef.current,
          voidedAt: new Date("2030-02-01T00:00:01.000Z"),
        });
      },
    },
    {
      name: "reject-terminal-void",
      run: async () => {
        try {
          await voidMarket({ db: input.db, marketId: marketIdRef.current });
        } catch {
          return;
        }

        throw new Error("Expected terminal void to reject");
      },
    },
  ];
}

function buildStress(input: {
  db: DbClient;
  fixture: QaFixture;
  qaRunId: string;
  seed?: number;
}): QaAction[] {
  const actions: QaAction[] = [];
  const random = mulberry32(input.seed ?? 1);

  for (let index = 0; index < 25; index += 1) {
    const scenario = random() < 0.4 ? "cancellation" : "happy-path";
    const marketIdRef = { current: "" };

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
        name: `stress-${index}-void-market`,
        run: async () => {
          await voidMarket({ db: input.db, marketId: marketIdRef.current });
        },
      });
    } else {
      actions.push({
        name: `stress-${index}-close-market`,
        run: async () => {
          await closeMarket({ db: input.db, marketId: marketIdRef.current });
        },
      });
    }
  }

  return actions;
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
