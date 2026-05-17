# Future Community-Scoped Roles

## Current Decision

Authorization roles are global for now. A `market_admin` can manage markets across the whole app. This keeps the API provider-neutral and avoids modeling communities before the product needs them.

## Why This May Need To Change

If Habit Gamba supports multiple separate Discord servers, Slack workspaces, web groups, organizations, or other social spaces, global roles become too broad. A Discord server admin should usually manage markets for only that server, not every market in the app.

## Future Model

Add first-class app communities, then scope roles to those communities.

```text
communities
- id
- provider        -- "discord", "slack", "web", etc.
- provider_id     -- provider-specific guild/workspace/group id
- display_name
- metadata
- created_at
- updated_at
```

```text
user_roles
- id
- user_id
- role            -- "market_admin"
- scope_type      -- "global" | "community"
- scope_id        -- "*" | community id
- created_at
- updated_at
```

Markets created from a community-backed adapter should carry `community_id`. API authorization can then check creator ownership or `market.manage` in that market's community scope.

## Migration Path

1. Add `communities` table and nullable `markets.community_id`.
2. Backfill Discord-created markets into communities using stored market metadata if available.
3. Add scoped `user_roles` columns while preserving existing global roles.
4. Update permission checks to prefer community scope and fall back to global roles.
5. Let adapters map provider-specific spaces to communities through API endpoints.

Provider facts should stay at adapter edges. API should see app concepts like `community`, `role`, and `permission`, not Discord-specific permissions such as guild admin.
