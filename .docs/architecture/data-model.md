# Data Model And Invariants

Postgres uses Drizzle SQL migrations. Primary keys are ULID text; persisted money, shares, LMSR quantities, fees, payouts, and balances use bigint micro-units.

Core tables: `users`, `balances`, `markets`, `contracts`, `positions`, `trades`, `ledger_entries`, and `resolutions`. `markets` are habit questions; `contracts` are binary YES/NO tradable outcomes.

REP is the only currency: `1 REP = 1_000_000` micro-units. `ledger_entries` are the append-only source of truth; `balances` are cached projections updated transactionally.

## Tables

`users` stores app users and one provider identity pair. `balances` stores cached current REP per user/currency.

`markets` stores the parent habit question and lifecycle status: `draft`, `open`, `closed`, `resolved`, or `void`. `contracts` stores the binary YES/NO tradable outcomes under each market.

`positions` stores net user holdings per contract. `trades` stores LMSR-only trade history with idempotency keys.

`ledger_entries` stores every REP movement with source/idempotency fields. `resolutions` stores one winning contract per resolved market, with manual fields now and nullable oracle fields for later.

## Important Invariants

Check these frequently in tests and QA scenarios.

```text
Every balance change has a ledger entry.
Cached balances equal ledger-derived balances.
Every trade references a valid user, market, and contract.
Every position references a valid user and contract.
No cached balance goes negative.
Each binary market has exactly one YES contract and one NO contract.
DRAFT/OPEN/CLOSED markets do not have resolutions.
RESOLVED markets have exactly one resolution row.
VOID markets refund users by ledger entries.
LMSR prices stay between 0 and 1.
YES price + NO price is approximately 1 before rounding.
Trade and ledger idempotency keys prevent duplicate money writes.
```
