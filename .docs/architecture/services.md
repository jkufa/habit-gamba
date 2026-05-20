# Domain Package Architecture

Domain packages own business rules; apps should validate/adapt requests and call packages rather than duplicate logic.

`users` owns provider identity and profile behavior. `contracts` owns YES/NO instruments under markets. `exchange` owns LMSR-only quotes, trades, positions, and market state changes.

`wallet` owns REP ledger and balance projection mutations. `resolution` owns manual/oracle-ready market resolution, refunds, and payouts. `notification` owns user-facing messages without leaking provider-specific delivery into domain logic.

## Market Lifecycle Worker

`apps/market-lifecycle-worker` owns scheduled market maintenance. It is scheduled externally and exits after one batch.

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

The worker uses `packages/logger` for wide structured events, metrics, and optional traces. Future steps: split closed-market voiding into a grace worker.

## Event Delivery Worker

`apps/event-worker` owns durable async side effects from committed domain events. It runs continuously, lazily materializes `event_deliveries` rows for supported event types, claims due rows with `FOR UPDATE SKIP LOCKED`, and records delivery state per consumer.

V1 consumer:

```text
discord-market-notifications
```

V1 event flow:

```text
market.resolved / market.voided event
  -> event_deliveries row
  -> Discord notification intent from packages/notification
  -> Discord REST delivery adapter
  -> delivered, skipped, failed, or dead
```

Missing Discord thread metadata is marked `skipped` with `missing_discord_thread_id`; this is valid for API-only or non-Discord markets and should not be retried. Transient provider failures retry with short backoff and then move to `dead`.
