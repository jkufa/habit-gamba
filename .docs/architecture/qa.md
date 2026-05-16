# QA Strategy

Run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` before considering work complete. Never run `bun test`.

Current tests cover env parsing, REP micro-unit constants, and gated Postgres integration for migrations/seed/balance-vs-ledger checks.

## Highest-Risk Areas

- LMSR pricing and rounding.
- Wallet debits/credits.
- Ledger consistency.
- Idempotent trades and money writes.
- Payout math.
- Refunds and void markets.
- Market lifecycle transitions.
- Reconnect/retry behavior.
- Stress scenarios with many trades.

## Scenario Test Shape

Suggested QA structure:

```text
packages/qa/
  scenarios/
    happy-path.ts
    void-market.ts
    stress-500-trades.ts
  seeds/
    users.ts
    markets.ts
  assertions/
    invariants.ts
  runner.ts
```

Example commands:

```bash
bun qa run happy-path
bun qa run void-market
bun qa run stress --trades 500 --seed 12345
```

A good stress test should:

```text
Seed users
Create markets and YES/NO contracts
Execute hundreds of randomized LMSR buys
Resolve or void markets
Assert ledger/balance/position invariants
Print a QA report
```

## Initial POC Scope

Build:

```text
/create-market
/market
/buy
/resolve
/portfolio
/leaderboard
```

Skip for now:

```text
selling shares
limit orders
real-time price streams
complex disputes
multiple currencies
double-entry accounting
separate deployed microservices
```
