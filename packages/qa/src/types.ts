import type { DbClient, InvariantCheck, InvariantReport, InvariantScope } from "@habit-gamba/db";
import type { User } from "@habit-gamba/users";

export type QaScenarioName = "cancellation" | "happy-path" | "stress";
export type QaScopeName = "all" | "qa";

export type QaFixture = {
  minimumRepMicro: bigint;
  users: User[];
};

export type QaCheckpoint = {
  actionName?: string;
  label: "after-action" | "after-scenario" | "before-scenario" | "check";
  reports: InvariantReport[];
};

export type QaCommandResult = {
  checkpoints: QaCheckpoint[];
  ok: boolean;
};

export type QaSetupOptions = {
  db: DbClient;
  minimumRepMicro?: bigint;
};

export type QaRunOptions = {
  checks?: InvariantCheck[];
  db: QaSetupOptions["db"];
  scenario: QaScenarioName;
  seed?: number;
  scope?: InvariantScope;
};

export type QaCheckOptions = {
  checks?: InvariantCheck[];
  db: QaSetupOptions["db"];
  scope?: InvariantScope;
};
