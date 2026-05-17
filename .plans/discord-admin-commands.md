# Discord Admin Commands

## Should Add Soon

- `/admin markets` list markets by status/creator, including stuck draft/open/closed.
- `/admin market view <market>` show internal IDs, creator, thread IDs, ledger/trade counts.
- `/admin market cancel <market> reason` explicit admin override path, separate from creator cancel.
- `/admin user view <user>` show linked Discord user, REP balance, status.
- `/admin user grant <user> amount reason` dev/test faucet.
- `/admin user deactivate <user> reason` for account abuse or spam.
- `/admin health` DB/bot status, command version, guild ID.

## Maybe Later

- `/admin market reopen <market>` only if lifecycle supports it. It does not today.
- `/admin market edit <market>` title/description/close date. Useful, but needs audit trail.
- `/admin threads repair` recreate missing market threads or summary messages.
- `/admin qa reset` dangerous, dev-guild only.

## Priority

Most important for current QA/testing:

1. `/admin user grant`
2. `/admin market view`
3. `/admin market cancel`
4. `/admin health`
5. `/admin threads repair`
