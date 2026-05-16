import { createId, repToMicro } from "@habit-gamba/db";
import { ensureSeedRepGrant, upsertUser } from "@habit-gamba/users";
import { getBalance } from "@habit-gamba/wallet";

import type { QaFixture, QaSetupOptions } from "./types";

const FIXTURE_PROVIDER = "qa";
const FIXTURE_USER_KEYS = ["creator", "bettor-a", "bettor-b"] as const;
const DEFAULT_MINIMUM_REP_MICRO = repToMicro(1_000n);

export async function setupQaFixtures(options: QaSetupOptions): Promise<QaFixture> {
  const minimumRepMicro = options.minimumRepMicro ?? DEFAULT_MINIMUM_REP_MICRO;
  const users = [];

  for (const key of FIXTURE_USER_KEYS) {
    const user = await upsertUser({
      db: options.db,
      displayName: `QA ${key}`,
      metadata: { qa: true, qaFixture: true },
      provider: FIXTURE_PROVIDER,
      providerUserId: key,
    });

    const balance = await getBalance({ db: options.db, userId: user.id });

    if (balance.availableAmountMicro < minimumRepMicro) {
      const amountMicro = minimumRepMicro - balance.availableAmountMicro;
      const idempotencyKey = [
        "qa-setup",
        "minimum-rep",
        user.id,
        minimumRepMicro.toString(),
        balance.availableAmountMicro.toString(),
      ].join(":");

      await ensureSeedRepGrant({
        amountMicro,
        db: options.db,
        idempotencyKey,
        metadata: {
          qa: true,
          qaSetup: true,
          targetAmountMicro: minimumRepMicro.toString(),
        },
        sourceId: idempotencyKey,
        userId: user.id,
      });
    }

    users.push(user);
  }

  return {
    minimumRepMicro,
    users,
  };
}

export function createQaRunId(seed: number | undefined): string {
  return `qa-${seed ?? "run"}-${createId().toLowerCase()}`;
}
