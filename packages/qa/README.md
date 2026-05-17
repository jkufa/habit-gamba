# `@habit-gamba/qa`

Shared QA package. It will hold scenario helpers and invariant checks for deterministic market/accounting tests.

## Commands

- `bun qa setup`: idempotently creates QA fixture users and grants minimum REP deltas.
- `bun qa check --scope all|qa`: runs invariant checks without mutating scenario state.
- `bun qa run happy-path|cancellation|stress --seed 123`: runs a tagged scenario and checks invariants before, after each action, and after the scenario. Scenarios create markets, execute trades, and settle via resolution or cancellation.

`--trades` runs a bounded concurrent trade stress scenario and resolves the market after trading. `--setup-isolated-db` recreates `habit_gamba_qa` and requires `--allow-destructive`.

Auto-cancellation currently covers expired open markets only. There is intentionally no grace-period cancellation for closed unresolved markets yet.
