# QA Strategy And POC Scope

Build deterministic scenario testing before Discord E2E.

The Discord bot should only need thin smoke tests because it is an adapter. Most risk lives in domain behavior.

## Highest-Risk Areas

- LMSR pricing.
- Wallet debits/credits.
- Ledger consistency.
- Payout math.
- Refunds.
- Creator penalties.
- Contract lifecycle transitions.

## Scenario Test Shape

Suggested QA structure:

```text
qa/
  scenarios/
    happy-path.ts
    cancellation.ts
    stress-500-trades.ts
  seeds/
    users.ts
    contracts.ts
  assertions/
    invariants.ts
  runner.ts
```

Example commands:

```bash
bun qa run happy-path
bun qa run cancellation
bun qa run stress --trades 500 --seed 12345
```

A good stress test should:

```text
Seed users
Create contracts
Execute hundreds of randomized buys
Resolve or cancel contracts
Assert all invariants
Print a QA report
```

## Initial POC Scope

Build:

```text
/create-contract
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
real-time prices
complex disputes
multiple currencies
double-entry accounting
separate deployed microservices
```
