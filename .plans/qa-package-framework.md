# QA Package Framework Plan

## Summary

Build `packages/qa` into a runnable scenario harness, aligned with `.docs/architecture/qa.md`, starting with wallet/accounting scenarios because exchange/contracts/resolution are still placeholders.

QA will mutate dev/test databases with namespaced durable rows, refuse production, run scenarios via root `bun qa run ...`, print human reports by default, and support `--json` for automation.

## Key Changes

- Add root command:
  - `bun qa run wallet-smoke`
  - `bun qa run wallet-concurrency`
  - `bun qa run seed-invariants`
  - `bun qa run all`
  - optional `--json`
- Add QA package structure:
  - `src/runner.ts`: CLI parsing, env guard, scenario selection, aggregate reporting, exit codes.
  - `src/scenarios/`: first runnable scenarios.
  - `src/seeds/`: deterministic QA user helpers.
  - `src/assertions/`: invariant assertions wrapping domain helpers.
  - `src/report.ts`: shared report types and console/JSON rendering.
- Add `@habit-gamba/db`, `@habit-gamba/env`, and `@habit-gamba/wallet` dependencies to `packages/qa`.
- Refuse `NODE_ENV=production`; otherwise use `DATABASE_URL` from env and keep QA-created rows for debugging.
- Scenario semantics:
  - `wallet-smoke`: create namespaced QA user, credit REP, debit REP, refund REP, assert final balance and REP ledger invariant.
  - `wallet-concurrency`: create/fund QA user, run concurrent duplicate idempotency and concurrent debit checks, assert no overspend and no duplicate ledger effect.
  - `seed-invariants`: run existing seed flow, assert REP ledger invariant using wallet helper.
  - `all`: run all scenarios, continue after failures, exit nonzero if any fail.

## Public Interfaces

- Export reusable QA helpers from `@habit-gamba/qa`:
  - `createQaUser(db, options?)`
  - `fundQaUser(db, options)`
  - `assertRepLedgerInvariant(db, options?)`
  - `runQaScenario(name, options)`
  - `runQaScenarios(names, options)`
- Reports return structured data:
  - scenario name, status, duration, checks, error details, created entity ids.
- QA assertions wrap `@habit-gamba/wallet` invariant helpers; QA does not duplicate wallet accounting math.

## Test Plan

- Add QA tests for CLI-free runner functions:
  - unknown scenario returns/throws clear error.
  - `wallet-smoke` passes against DB when `DATABASE_URL` exists.
  - `wallet-concurrency` passes against DB when `DATABASE_URL` exists.
  - `seed-invariants` passes against DB when `DATABASE_URL` exists.
  - production env guard rejects execution.
- Keep DB-backed tests gated when `DATABASE_URL` is absent.
- Verification remains:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
  - `bun run test`
  - direct env-file QA test run to confirm DB-backed scenarios execute.

## Assumptions

- QA v1 is wallet/accounting-focused until exchange/contracts/resolution have real APIs.
- QA rows are durable and namespaced, not rolled back.
- No temporary mock market/trade logic in QA; future market scenarios must call real domain packages.
