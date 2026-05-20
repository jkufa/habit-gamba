# Event Delivery Worker Plan

## Summary

Backend domain events should notify Discord through a separate event delivery worker, not by messaging the long-running Discord bot process.

## Decision

Build a future `apps/event-worker` that consumes durable outbox events from the database and delivers provider-specific notifications. For Discord, it should use Discord APIs directly with bot credentials and market Discord metadata.

Do not make `apps/server` or `apps/worker` call into the Discord gateway bot process. The gateway bot remains command ingress: slash commands, buttons, modals, identity extraction, and immediate interaction replies.

## Why

- Durable events survive bot restarts, deploys, and network failures.
- Delivery retries/backoff stay separate from market lifecycle maintenance.
- Discord notification failures do not block settlement transactions.
- Multiple consumers can process the same domain event later: Discord, email, analytics, audit export.
- The bot process stays simple and provider-adapter focused.

## V1 Flow

```text
domain transaction
  -> write markets/resolutions/cancellations
  -> write events row
  -> commit

event-worker
  -> claim pending event for consumer
  -> load market Discord metadata
  -> post/update Discord thread/message
  -> mark delivery processed or failed
```

Current outbox stores immutable events only. Add delivery state when the first consumer is implemented. Use a table such as `event_deliveries` keyed by `(event_id, consumer_name)` so each consumer can retry independently.

## Initial Events

- `market.resolved`: update market thread summary and post resolution notice.
- `market.voided`: update market thread summary and post void/refund notice.

Future events may include `market.opened`, `trade.created`, or explicit notification request events if product copy and throttling need a stronger abstraction.

## Boundaries

`packages/notification` should own notification composition: which domain event becomes which user-facing message. Provider-specific delivery stays in app adapters such as `apps/event-worker`.

`apps/event-worker` should not own market settlement rules, wallet mutation, or command handling. It reads committed events and performs idempotent external delivery.

`apps/bot` should not become an internal message bus. If the event worker and bot share Discord formatting helpers, extract those helpers into a package rather than sending internal messages between processes.
