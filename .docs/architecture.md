# Habit Gamba Architecture

Habit Gamba is a proof of concept for a social prediction market for personal habits/goals. Users create contracts, buy YES/NO shares using rep, and resolve outcomes through Discord commands.

Build as a **modular monolith**: separate packages/modules with clear ownership, all running in one deployable/process where practical. Do not split into real microservices yet.

## Agent Loading Guide

Read this file first. Load deeper docs only for task-relevant areas:

- [.docs/architecture/services.md](./architecture/services.md): service ownership, command/API flow, lifecycle rules.
- [.docs/architecture/components.md](./architecture/components.md): app/package responsibilities and adapter examples.
- [.docs/architecture/data-model.md](./architecture/data-model.md): balances, ledger entries, trades, positions, contracts, invariants.
- [.docs/architecture/qa.md](./architecture/qa.md): deterministic scenario testing, stress tests, POC scope.

## High-Level Flow

```text
Discord User
  ↓
Discord Bot
  ↓
API Server
  ↓
Domain Packages
  ├─ Users
  ├─ Contracts
  ├─ Exchange
  ├─ Wallet
  ├─ Resolution
  └─ Notification
  ↓
Database
```

Bot and API stay thin. Most business rules live in domain packages.

Core system:

```text
Commands → domain packages → database transaction → ledger/trade/position updates → notification
```

## Suggested Project Structure

```text
.
├── apps/
│   ├── bot/
│   └── server/
└── packages/
    ├── db/
    ├── users/
    ├── contracts/
    ├── exchange/
    ├── wallet/
    ├── resolution/
    └── notification/
```

## Components

### `apps/bot`

Discord-specific interface layer.

### `apps/server`

REST API layer used by the bot.

### `packages/db`

Database schema and local database tooling.

### `packages/users`

Discord-to-app user identity.

### `packages/contracts`

Contract creation and lifecycle.

### `packages/exchange`

Pricing, trades, and positions.

### `packages/wallet`

Rep balances and ledger entries.

### `packages/resolution`

Resolution, cancellation, refunds, and payouts.

### `packages/notification`

User-facing notifications.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Predictable behavior under load and failure: session restarts, reconnects, partial streams.

If tradeoff required, choose correctness and robustness over short-term convenience.

## Design Principle

Keep architecture boring and transactionally safe. Optimize for correctness, debuggability, and fast simulation testing before scale.
