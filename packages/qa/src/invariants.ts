import type { InvariantCheck, InvariantReport, InvariantScope } from "@habit-gamba/db";
import type { DbClient } from "@habit-gamba/db";

export async function runInvariantSuite(input: {
  checks: InvariantCheck[];
  db: DbClient;
  scope?: InvariantScope;
}): Promise<InvariantReport[]> {
  const reports: InvariantReport[] = [];

  for (const check of input.checks) {
    reports.push(
      await check({
        db: input.db,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      }),
    );
  }

  return reports;
}

export function hasInvariantFailures(reports: InvariantReport[]): boolean {
  return reports.some((report) => !report.ok);
}
