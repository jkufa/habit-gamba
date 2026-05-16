# Component Responsibilities

This doc expands the one-line component map in [.docs/architecture.md](../architecture.md).

## `apps/bot`

Discord-specific interface layer.

Owns:

- Slash commands.
- Discord user identity.
- Button confirmations.
- Formatting Discord responses.

Should not own:

- Pricing math.
- Balance logic.
- Payout logic.
- Contract lifecycle rules.

Example commands:

```text
/create-contract
/market
/buy
/resolve
/portfolio
/leaderboard
```

## `apps/server`

REST API layer used by the bot.

Owns:

- HTTP routes.
- Request validation.
- Auth/user mapping.
- Calling service methods.
- Returning API responses.

Example routes:

```text
POST /contracts
GET /contracts/:id
POST /contracts/:id/buy
POST /contracts/:id/resolve
GET /users/:id/portfolio
```

## `packages/db`

Database schema and local database tooling.

Owns:

- Migrations.
- Seed scripts.
- Local reset/setup scripts.
- Typed DB client, if applicable.

## Domain Packages

Business rules and transaction orchestration.

Domain packages should be framework-agnostic where possible. They should accept validated inputs, run domain rules, mutate database state inside explicit transactions, and return data that adapters can format.

Each domain is its own package:

```text
packages/users
packages/contracts
packages/exchange
packages/wallet
packages/resolution
packages/notification
```
