# Habit Gamba Architecture

Habit Gamba is a Bun/Turbo proof of concept for a social prediction market for personal habits. It is a modular monolith: thin apps, domain packages, and one Postgres-backed data model.

Read task-relevant docs only:

- [components.md](./architecture/components.md): app/package ownership.
- [data-model.md](./architecture/data-model.md): schema and invariants.
- [services.md](./architecture/services.md): domain package responsibilities.
- [qa.md](./architecture/qa.md): testing priorities.

## High-Level Flow

```text
Chat/Web User
  ↓
Bot or API Server
  ↓
Domain Packages
  ├─ Users
  ├─ Contracts
  ├─ Exchange
  ├─ Wallet
  ├─ Resolution
  └─ Notification
  ↓
Postgres
```

Bot and API stay thin. Business rules live in domain packages, and durable state changes go through explicit database transactions.

Core system:

```text
Command/API request → domain package → database transaction → ledger/trade/position updates → notification
```

## Project Structure

```text
.
├── apps/
│   ├── bot/
│   └── server/
└── packages/
    ├── db/
    ├── env/
    ├── users/
    ├── contracts/
    ├── exchange/
    ├── wallet/
    ├── resolution/
    ├── notification/
    └── qa/
```

## Components

### `apps/bot`

Provider-neutral bot worker for chat-command adapters.

### `apps/server`

Hono HTTP API layer.

### `packages/db`

Drizzle schema, migrations, DB client, seed data, IDs, and currency constants.

### `packages/env`

Shared typed env parsing.

### `packages/users`

Provider identity and app user behavior.

### `packages/contracts`

Binary YES/NO outcome instruments under parent markets.

### `packages/exchange`

LMSR quotes, trades, positions, and market state changes.

### `packages/wallet`

REP balances, ledger entries, debits, credits, refunds, and payouts.

### `packages/resolution`

Manual/oracle-ready resolution, cancellation, refunds, and payouts.

### `packages/notification`

User-facing notification composition and delivery boundaries.

### `packages/qa`

Scenario helpers and invariant checks.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Predictable behavior under load and failure: session restarts, reconnects, partial streams, and retries.

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Design Principle

Keep architecture boring and transactionally safe. Optimize for correctness, debuggability, and deterministic simulation testing before scale.
