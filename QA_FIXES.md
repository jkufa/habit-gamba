# Discord Bot QA Fixes

## Summary

QA found mostly bot UX and policy gaps, not infra failures. Root theme:
current bot uses generic market autocomplete, text-only modal fields, and raw
domain error passthrough.

## Findings And Fixes

### 1. `/account register` re-registers existing users

Root cause:

- `apps/bot/src/handlers/account.ts` always calls `registerAccount`.
- `registerAccount` uses `upsertUser`, so existing users update and starter grant
  stays idempotent, but UX still says `Registered`.
- Discord cannot dynamically hide one slash subcommand per user after command
  registration.

Fix:

- In account handler, call `getDiscordUser` first.
- If user exists, reply ephemeral: `You're already registered. Balance: X REP`.
- Only call `registerAccount` when no user exists.

### 2. Market create description says "binary market"

Root cause:

- `apps/bot/src/commands.ts` sets `/market create` description to
  `Create a binary market`.

Fix:

- Change copy to `Create a YES/NO market`.

### 3. Slug exposed in create command/modal

Root cause:

- `apps/bot/src/commands.ts` exposes `slug`.
- `apps/bot/src/handlers/market.ts` exposes `Slug` modal input.
- `apps/bot/src/service.ts` already autogenerates slug when empty.

Fix:

- Remove slash option and modal field for slug.
- Remove slug from `createMarketFromValues`.
- Keep backend `slug?: string | null` only if other callers need it.

Consequences:

- Pros: simpler UX, fewer uniqueness/conflict errors, no user-facing internal ID.
- Cons: users cannot choose memorable slugs; autocomplete/search must rely on
  title. Existing stored slugs remain valid.

### 4. "Open now?" is text input instead of buttons/dropdown

Root cause:

- Discord modals only support text inputs.
- Current modal uses `textInput("open", "Open now? yes/no", ...)`.

Fix:

- Do not put `open now` inside create modal.
- After create modal submits, reply ephemeral with buttons:
  `Create draft` and `Create + open`.
- If `Create + open`, show second modal for close date, or use preset buttons.

### 5. `closes_at` ISO time UX is bad

Root cause:

- Commands label close input as ISO date/time.
- `parseDate` uses `new Date(value)`, which is permissive but unclear.
- Discord slash/modal inputs do not provide native date picker.

Fix:

- Remove `closes_at` from `/market create`; creation should draft only.
- For `/market open`, accept `MM/DD/YYYY` only.
- Parse close date as America/New_York at `23:59:59`.
- Update copy to `Close date (MM/DD/YYYY)`.
- Optional later: add preset buttons like `Tomorrow`, `This Sunday`, `In 7 days`.

### 6. Creator can buy own market

Root cause:

- `apps/bot/src/service.ts` `buyMarketCommand` does not check
  `market.creatorUserId`.
- Exchange domain allows any funded user to trade any open market.

Fix:

- In bot service before quote/buy: if `input.actor.userId === market.creatorUserId`,
  throw bot-level policy error.
- Copy: `You can't trade on a market you created.`
- Consider same guard in exchange domain later if creator self-trading must be
  impossible across all clients.

### 7. Trade summary close date is raw ISO

Root cause:

- `marketSummaryFields` formats `closesAt` with `.toISOString()`.
- All market embeds use that helper.

Fix:

- Add `formatCloseDate(date)` for Discord display.
- Use ET display, e.g. `May 24, 2026, 11:59 PM ET`.
- Consider Discord timestamp markup: `<t:UNIX:f>` plus `<t:UNIX:R>`.

### 8. Thread summary not updated with latest prices

Root cause:

- `buyMarketFromValues` posts one plain text trade summary.
- No persistent summary message ID is stored in market metadata.
- Bot stores only `threadId`, `channelId`, `guildId`.

Fix:

- On market open, create first thread summary message with market embed.
- Store `summaryMessageId` in `market.metadata.discord`.
- After each trade, fetch/edit summary message with latest market embed.
- Continue posting individual trade messages below it.

### 9. Cancel confirmation/penalty missing for creator-admin

Root cause:

- Confirmation path is gated by `!actor.isGuildAdmin && actor.userId === market.creatorUserId`.
- If creator also has server admin permission, bot takes admin path and skips
  confirmation.
- Confirmation says 10% penalty but does not calculate REP amount.

Fix:

- If actor is creator, always show creator cancellation confirmation, even if admin.
- Admin override path should apply only when actor is not creator.
- Show calculated penalty amount before confirm.
- Add bot helper/query for refund total or expose dry-run estimate from resolution.

### 10. Cancel refund seemed missing

Root cause:

- Domain cancellation should refund all buy spends via `loadRefundRows`.
- If creator bought own market, cancel produces refund and creator penalty. Net
  effect is `refund - penalty`, so balance may still look lower than expected.
- Current bot confirmation does not show refund total, penalty, or net effect.

Fix:

- Add cancel preview:
  - total refund amount
  - creator penalty amount
  - creator net balance effect
- Add integration test for creator self-trade then cancel until self-trading guard lands.
- If ledger proves no refund, debug `schema.trades.side = "buy"` rows and
  `sourceType = cancellation_refund` ledger entries.

### 11. `/market open` autocomplete shows all markets

Root cause:

- `apps/bot/src/handlers/index.ts` calls `autocompleteMarkets` without
  command/subcommand/user context.
- `apps/bot/src/service.ts` `autocompleteMarkets` searches all markets.

Fix:

- Pass command/subcommand and actor identity into autocomplete handler.
- For open/close/resolve/cancel: filter to creator markets unless actor is admin.
- For buy: filter to open markets not created by actor.
- For view: all visible markets are fine.

### 12. "Market does not accept bets" copy

Root cause:

- `packages/exchange/src/errors.ts` message is `Market does not accept bets`.
- Bot error handler returns raw `error.message`.
- `MarketNotTradeableError.details` has `status`, `closesAt`, and `now`, but bot
  does not map it.

Fix:

- Change domain copy to `Market does not accept trades`, or map in bot.
- Bot should catch `MarketNotTradeableError` and reply specific reasons:
  - `draft`: `This market is not open yet.`
  - `closed`: `This market is closed.`
  - `resolved`: `This market is already resolved.`
  - `void`: `This market was cancelled.`
  - `open` with `now >= closesAt`: `This market is past its close time.`

## Suggested Implementation Order

1. Copy fixes: command descriptions, date labels, not-tradeable error mapping.
2. Account registration idempotent UX.
3. Creator self-trade guard.
4. Slug removal and date parsing change.
5. Autocomplete filtering by subcommand and actor.
6. Cancel preview/confirmation with creator-admin behavior.
7. Thread summary message edit after trades.

## Acceptance Checks

- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test` pass.
- Existing registered user sees already-registered copy.
- Creator cannot buy own market.
- `/market open` autocomplete only shows creator markets for non-admin.
- Creator cancel always shows confirmation with exact penalty.
- Buy error says "trade" and explains reason.
- Thread top summary updates prices after each trade.
