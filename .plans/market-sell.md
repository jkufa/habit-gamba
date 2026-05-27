# Market Sell V1

Adds `/market sell` support across exchange, API, bot, help, and tests.

## Modes

- `sell_shares`: sell an exact number of owned YES or NO shares.
- `target_rep`: receive at least a target REP amount by selling the minimum shares needed.

Buy modes remain unchanged in this repo: `spend_rep` and `buy_shares`.

## Behavior

- Sells only burn owned shares of the selected outcome. Shorts are not supported.
- `target_rep` is capped by the user's full owned position and fails if that position cannot meet the target.
- Both sell input and resulting counter-amount must meet the 0.01 threshold.
- Sell proceeds are credited through the REP ledger as a payout with `sourceType = "exchange_trade"`.
- Sells fail for closed or expired markets, creator self-trades, missing/insufficient positions, and idempotency conflicts.

## Examples

- `/market sell outcome:YES mode:Sell shares shares:2`
- `/market sell market:example-slug outcome:NO mode:Target REP target_rep:5`
