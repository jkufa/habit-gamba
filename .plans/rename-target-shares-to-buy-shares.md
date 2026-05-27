# Rename `target_shares` To `buy_shares`

## Goal

Fully replace the buy sizing mode name `target_shares` with `buy_shares`.

## Desired Shape

- Public buy modes are `spend_rep` and `buy_shares`.
- `target_shares` is not accepted by API schemas, bot handlers, bot service types, help, or tests.
- Discord command label/value becomes `Buy shares` / `buy_shares`.
- Slash option becomes `buy_shares`.

## Implementation Plan

1. Update server trade request parsing:
   - Accept only `spend_rep` and `buy_shares`.
   - Branch exchange calls on `buy_shares`.
2. Update bot command and handler surfaces:
   - Change the Discord mode choice label/value to `Buy shares` / `buy_shares`.
   - Rename the slash option from `target_shares` to `buy_shares`.
   - Update modal copy to `spend_rep or buy_shares`.
3. Update bot service:
   - Type buy mode as `spend_rep | buy_shares`.
   - Send `buy_shares` to the API for exact-share buys.
4. Update docs and tests:
   - Refresh help/glossary copy.
   - Cover server `buy_shares`.
   - Remove legacy `target_shares` expectations.

## Touched Areas

- `apps/server/src/schemas.ts`
- `apps/server/src/app.ts`
- `apps/bot/src/commands.ts`
- `apps/bot/src/handlers/utils.ts`
- `apps/bot/src/handlers/market.ts`
- `apps/bot/src/service.ts`
- `apps/bot/src/help-content.ts`

## Rollout Note

Redeploy Discord commands with the new `buy_shares` option before relying on exact-share buys in production. Old command registrations that still send `target_shares` will fail after this change.
