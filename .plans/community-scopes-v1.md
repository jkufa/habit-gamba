# Community-Scoped V1 — Rollout Completion

## Status

Branch `feat/community` implements the core V1 from `future-community-scopes.md`:

- `communities`, `community_memberships`, scoped `user_roles`
- Nullable `community_id` on `markets`, `balances`, `ledger_entries` with backfill to `community_system_default`
- Community headers on API routes; Discord bot resolves guild → community on scoped commands
- Wallet, exchange, resolution, recurring, and leaderboard paths are community-aware
- Isolation integration tests in `apps/server/src/community-scopes.test.ts`

This plan covers the remaining work to roll out safely and harden the schema.

## Phase 1 — Close behavioral gaps

### Role semantics

Plan intent: `market_admin` manages only its scoped community; `admin` remains global.

Current behavior merges **global** roles into community permission checks, so a globally granted `market_admin` can still manage markets in any community.

- [ ] Decide policy:
  - **A.** Keep global `market_admin` as legacy operator access (document explicitly), or
  - **B.** Treat `market_admin` as community-scoped only — ignore global `market_admin` when checking `market.manage` in a community context
- [ ] Align `app.test.ts` ("global market admins…") with chosen policy
- [ ] Add test: global `admin` can manage a market in a community they are not a member of (plan line: "manage all markets")

### Account adjustment guardrails

Implemented but undertested:

- [ ] Add integration test: global admin adjustment returns 404 when target user has no membership in the request community

### Bot DM / no-guild rejection

- [ ] Add handler-level test (or bot integration test) asserting scoped commands do not call the API when `guildId` is null — not just `requireDiscordCommunity` unit coverage

### Membership refresh (optional V1.1)

`future-community-scopes.md` mentions refreshing membership on interaction. V1 only upserts on `/accounts/register`.

- [ ] Decide whether non-register commands should upsert membership / update `last_seen_at`
- [ ] If yes, add lightweight membership touch on authenticated bot requests

## Phase 2 — Schema hardening

After all writers consistently set `community_id` and rollout is stable:

### Migration `0010` (or next)

- [ ] `ALTER TABLE markets ALTER COLUMN community_id SET NOT NULL`
- [ ] `ALTER TABLE balances ALTER COLUMN community_id SET NOT NULL`
- [ ] `ALTER TABLE ledger_entries ALTER COLUMN community_id SET NOT NULL`
- [ ] Remove `DEFAULT_COMMUNITY_ID` fallbacks in exchange/resolution (`market.communityId ?? DEFAULT_COMMUNITY_ID`) — fail loudly instead

### Invariant checks

- [ ] Extend wallet/QA invariants to assert no null `community_id` rows post-hardening
- [ ] Confirm seed + fresh migrate path still uses `system` / `default` for empty installs

## Phase 3 — Test matrix (remaining)

| Scenario | Status |
|---|---|
| Same Discord user, two guilds → isolated balances + starter grants | Done |
| Buy in one community does not affect another balance/leaderboard | Done |
| Autocomplete / listing do not leak across communities | Done |
| Scoped `market_admin` own community only | Done |
| Global `admin` can adjust accounts | Done |
| Slug collision across communities | Done |
| DM / no-guild reject before API write | Partial (unit only) |
| Global `admin` cross-community market manage | Missing |
| Adjustment rejects non-member target | Missing |

## Out of scope for this plan

- Multi-instance / multi-guild production config without hardcoded migration guild IDs (needs env-driven or manual ops playbook per environment)
- Web default community UX (`system` / `default` seeded community for non-Discord clients)
- Leaderboard mark-to-market ranking (V1 ranks realized community REP only — matches plan)
- `help` / `glossary` in DMs (intentionally allowed; scoped economy commands require guild)

## Success criteria

V1 is complete when:

1. Role policy for global vs scoped `market_admin` is decided and tested
2. Remaining integration tests from Phase 1 and Phase 3 are green
3. Follow-up hardening migration makes core `community_id` columns non-null and removes silent fallbacks

## One-time ops note

Migration `0009_community_scopes.sql` remaps the default community to the existing Discord guild when backfilled balances exist. Drizzle will not re-run an applied migration.

For databases that migrated **before** that UPDATE was added, run once:

```sql
UPDATE communities
SET
  provider = 'discord',
  provider_community_id = '1505563251008737321',
  updated_at = now()
WHERE id = 'community_system_default'
  AND EXISTS (
    SELECT 1 FROM balances WHERE community_id = 'community_system_default'
  );
```

Adjust `provider_community_id` per deployment if this instance serves a different guild.
