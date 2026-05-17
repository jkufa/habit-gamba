# Community-Scoped Platform Plan

## Current Direction

Habit Gamba should evolve as one multi-community platform, not as one isolated app instance
per bot or Discord server. A platform instance should own one database, one API, one exchange
implementation, and one wallet/accounting system. Bots and future web clients are adapters that
map provider-specific spaces into app-level communities.

The `community` is the tenant and accounting boundary. Discord guilds, Slack workspaces, web
groups, and a future centralized Habit Gamba web community should all map to the same provider-
neutral community model.

## Why This Matters

Global roles and global REP balances become too broad once multiple social spaces share the same
platform. A Discord server admin should manage only that server's markets. REP won in one group
should not leak into another group's leaderboard unless the product explicitly chooses a global
currency later.

Keeping exchange, wallet, and resolution in the same database transaction boundary is also the
right early scaling choice. Prediction market trades, balance updates, payouts, refunds, and
position changes need strong consistency. Network microservices can come later around async
boundaries such as notifications, bot posting, refresh jobs, and materialized read models.

## Target Model

```text
communities
- id
- provider                 -- "discord", "slack", "web", "system", etc.
- provider_community_id    -- provider-specific guild/workspace/group/default id
- slug
- display_name
- metadata
- created_at
- updated_at
```

```text
community_memberships
- id
- community_id
- user_id
- provider_member_id       -- Discord user id, Slack user id, etc.
- display_name_snapshot
- metadata
- last_seen_at
- created_at
- updated_at
```

```text
markets
- community_id             -- required for community-created markets after migration
```

```text
balances
- community_id
- user_id
- currency                 -- REP
- available_amount_micro
- locked_amount_micro
- credit_limit_micro

unique(user_id, currency, community_id)
```

```text
ledger_entries
- community_id
- user_id
- currency
- amount_delta_micro
- balance_after_micro
- reason
- source_type
- source_id
- idempotency_key
- metadata
```

```text
user_roles
- id
- user_id
- role                     -- "market_admin"
- scope_type               -- "global" | "community"
- scope_id                 -- "*" | community id
- created_at
- updated_at
```

## Product Semantics

- Markets belong to exactly one community.
- REP balances are isolated per community.
- Starter grants are per community membership, not global account grants.
- Trades debit the trader's REP balance in the market's community.
- Resolution payouts, cancellation refunds, and creator penalties write ledger entries in the
  market's community.
- Leaderboards are community-scoped. V1 should rank realized community REP net, not open-position
  mark-to-market value.
- Roles can be global for operators or scoped to one community for local market admins.

Example:

```text
User: Demo
Octokitty REP: 1200
Kitchen REP:   850

Buying an Octokitty market debits only Octokitty REP.
Kitchen leaderboard cannot see Octokitty gains.
```

## Adapter Boundaries

Provider facts stay at adapter edges. Core API should see app concepts like `community`, `role`,
`permission`, and `membership`, not Discord-specific concepts such as guild admin.

Discord v1 flow:

1. Bot receives guild interaction.
2. Bot resolves or upserts `{ provider: "discord", providerCommunityId: guildId }`.
3. Bot registers or refreshes membership for the acting user in that community.
4. Market create sends `communityId`.
5. Autocomplete, market management, wallet reads, and leaderboard reads include community context.

Future web flow:

1. Web app uses a seeded default community such as:

   ```text
   provider = "system" or "web"
   provider_community_id = "default"
   slug = "habit-gamba"
   display_name = "Habit Gamba"
   ```

2. Non-bot markets use that default community.
3. Additional web communities can be added without changing wallet or exchange schema.

## Migration Path

1. Add `communities` and `community_memberships`.
2. Seed a deterministic default `system` or `web` community.
3. Add nullable `community_id` columns to `markets`, `balances`, and `ledger_entries`.
4. Backfill existing markets, balances, and ledger entries into the default community.
5. Add scoped `user_roles` columns while preserving existing global roles as
   `scope_type = "global"` and `scope_id = "*"`.
6. Update wallet APIs to require `communityId` for balance reads and REP writes.
7. Update exchange and resolution paths to derive `communityId` from the market and pass it into
   wallet writes.
8. Update server routes to resolve community context for account registration, market creation,
   autocomplete, market management, and leaderboards.
9. Update Discord bot to resolve guilds into communities and reject community actions outside
   guild context.
10. Once code paths always write `community_id`, make the core community columns non-null where
    appropriate.

## Scaling Path

1. Keep the first implementation as a modular monolith with one Postgres database and strong
   transactions for wallet, exchange, and resolution.
2. Add background jobs or queues for Discord posting, refreshes, notifications, and other async
   work.
3. Add read replicas, cached leaderboard views, or materialized community stats if read load
   requires it.
4. Split network services only around async boundaries. Do not split wallet/exchange/resolution
   writes until there is a concrete scaling need and a transactionally safe design.
