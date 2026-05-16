import type { InvariantCheck, InvariantScope } from "@habit-gamba/db";

import { hasInvariantFailures, runInvariantSuite } from "./invariants";
import { defaultInvariantChecks } from "./registry";
import { buildScenario } from "./scenarios";
import { createQaRunId, setupQaFixtures } from "./setup";
import type { QaCheckOptions, QaCheckpoint, QaCommandResult, QaRunOptions } from "./types";

export async function runQaCheck(options: QaCheckOptions): Promise<QaCommandResult> {
  const reports = await runInvariantSuite({
    checks: options.checks ?? defaultInvariantChecks,
    db: options.db,
    scope: options.scope ?? { kind: "all" },
  });

  return {
    checkpoints: [{ label: "check", reports }],
    ok: !hasInvariantFailures(reports),
  };
}

export async function runQaScenario(options: QaRunOptions): Promise<QaCommandResult> {
  const checks = options.checks ?? defaultInvariantChecks;
  const fixture = await setupQaFixtures({ db: options.db });
  const qaRunId = createQaRunId(options.seed);
  const scope =
    options.scope ??
    ({
      kind: "qa",
      qaRunId,
      userIds: fixture.users.map((user) => user.id),
    } satisfies InvariantScope);
  const checkpoints: QaCheckpoint[] = [];
  const beforeReports = await checkpoint({
    checks,
    db: options.db,
    label: "before-scenario",
    scope,
  });

  checkpoints.push(beforeReports);

  if (hasInvariantFailures(beforeReports.reports)) {
    return { checkpoints, ok: false };
  }

  const actions = buildScenario({
    db: options.db,
    fixture,
    qaRunId,
    scenario: options.scenario,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  });

  for (const action of actions) {
    await action.run();

    const reports = await checkpoint({
      actionName: action.name,
      checks,
      db: options.db,
      label: "after-action",
      scope,
    });
    checkpoints.push(reports);

    if (hasInvariantFailures(reports.reports)) {
      return { checkpoints, ok: false };
    }
  }

  const afterReports = await checkpoint({
    checks,
    db: options.db,
    label: "after-scenario",
    scope,
  });
  checkpoints.push(afterReports);

  return {
    checkpoints,
    ok: !hasInvariantFailures(afterReports.reports),
  };
}

async function checkpoint(input: {
  actionName?: string;
  checks: InvariantCheck[];
  db: QaRunOptions["db"];
  label: QaCheckpoint["label"];
  scope: InvariantScope;
}): Promise<QaCheckpoint> {
  return {
    ...(input.actionName ? { actionName: input.actionName } : {}),
    label: input.label,
    reports: await runInvariantSuite({
      checks: input.checks,
      db: input.db,
      scope: input.scope,
    }),
  };
}
