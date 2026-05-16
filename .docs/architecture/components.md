# Component Responsibilities

This doc expands the component map in [.docs/architecture.md](../architecture.md).

## `apps/bot`

Provider-neutral long-running bot worker.

Owns:

- Chat provider adapter setup.
- Command registration/dispatch.
- Provider user identity extraction.
- Button or confirmation interaction adapters.
- Formatting chat responses.

Should not own:

- LMSR pricing math.
- Balance or ledger logic.
- Payout logic.
- Market or contract lifecycle rules.

Example commands:

```text
/create-market
/market
/buy
/resolve
/portfolio
/leaderboard
```

## `apps/server`

Hono API layer used by bot/web adapters.

Owns:

- HTTP routes.
- Request validation.
- Auth/user mapping.
- Calling domain package methods.
- Returning API responses.

Should not own:

- Pricing math.
- Ledger mutation rules.
- Resolution payout rules.
- Notification business rules.

Example routes:

```text
POST /markets
GET /markets/:id
POST /markets/:id/buy
POST /markets/:id/resolve
GET /users/:id/portfolio
GET /health
GET /health/db
```

## `packages/db`

Database schema and local database tooling.

Owns:

- Drizzle schema.
- SQL migrations.
- Seed scripts.
- Typed DB client factory.
- ULID helper.
- REP currency constants.

Should not own:

- Business workflows.
- API request validation.
- Provider-specific user mapping.

## `packages/env`

Typed runtime configuration.

Owns:

- Zod env schemas.
- Base env loader.
- App-specific env loaders.

Should not own:

- Database client creation.
- Secrets beyond validation/loading.
- Business config hidden in env.

## Domain Packages

Business rules and transaction orchestration.

Domain packages should be framework-agnostic where possible. They should accept validated inputs, run domain rules, mutate database state inside explicit transactions, and return data adapters can format.

Each domain is its own package:

```text
packages/users
packages/contracts
packages/exchange
packages/wallet
packages/resolution
packages/notification
```
