# Domain Package Architecture

Domain packages own business rules; apps should validate/adapt requests and call packages rather than duplicate logic.

`users` owns provider identity and profile behavior. `contracts` owns YES/NO instruments under markets. `exchange` owns LMSR-only quotes, trades, positions, and market state changes.

`wallet` owns REP ledger and balance projection mutations. `resolution` owns manual/oracle-ready market resolution, refunds, and payouts. `notification` owns user-facing messages without leaking provider-specific delivery into domain logic.

## Market Lifecycle Worker

`apps/worker` owns the one-shot `market-lifecycle-worker` process. It is scheduled externally and exits after one batch.

Runtime config:

```text
MARKET_LIFECYCLE_BATCH_LIMIT=100
```

V1 has no grace period. A market must be resolved before `closesAt`; resolving an open market at or after `closesAt` is rejected. The worker voids unresolved open markets whose `closesAt` has passed. `closed` remains a future lifecycle state for grace-period support, but until that exists the worker also voids any existing/manual closed unresolved markets.

Current flow:

```text
open -> resolved before closesAt
open -> void after closesAt if unresolved
closed -> void until grace-period worker exists
```

The worker uses a local JSON stdout logger adapter with fields aligned to the observability plan. Replace it with `packages/logger` when observability V1 lands. Future steps: split closed-market voiding into a grace worker, add event delivery state for multi-consumer processing, and build a bot/notification consumer for market outbox events.
