# Observability V1 Plan

## Summary

Add first-class observability for Habit Gamba with a local OSS Grafana LGTM stack: Grafana, Loki, Prometheus, Tempo, and Grafana Alloy. Use wide structured JSON events, Prometheus metrics, and OTLP traces. Keep domain events separate from observability logs, and name workers clearly before the future event delivery worker lands.

## Key Changes

- Add `packages/logger` with one shared logger API:
  - JSON-only stdout logs with `info` and `error`.
  - Common fields: `timestamp`, `level`, `service`, `env`, `version`, `commit_hash`, `request_id`, `trace_id`, `span_id`, `outcome`, `duration_ms`.
  - Redaction policy: log internal IDs only; no Discord tokens, handles, display names, raw message text, or raw request bodies.
  - Wide-event helpers for request/interaction lifecycle and business context accumulation.
- Add metrics and tracing support:
  - Server exposes `/metrics` for Prometheus scrape.
  - Apps export traces through OTLP to Alloy/Tempo.
  - Bot gets minimal metrics exposure compatible with Prometheus; if impractical in runtime, use OTLP metrics only for bot.
  - Instrument ingress plus key domain ops: HTTP requests, Discord interactions, DB health, market create/open/buy/resolve/cancel.
- Rename the existing batch worker:
  - `apps/worker` becomes `apps/market-lifecycle-worker`.
  - package name becomes `@habit-gamba/market-lifecycle-worker`.
  - service label remains `market-lifecycle-worker`.
  - behavior stays limited to market lifecycle maintenance.
- Add app integration:
  - Hono middleware emits one wide event per HTTP request and records request metrics/spans.
  - Discord interaction wrapper emits one wide event per interaction and records command/autocomplete/button/modal metrics/spans.
  - Replace current unstructured `console.*` in app runtime paths with shared logger.
- Keep domain events distinct from observability logs:
  - `events` table is durable domain/outbox state.
  - Loki logs are ephemeral operational telemetry.
  - `insertEvent` emits `event_inserted` telemetry with internal IDs only.
- Add event-delivery placeholders:
  - future `event_deliveries` table supports reliable async side effects.
  - first sink is `discord`.
  - future `apps/event-worker` owns delivery retries/backoff.
  - dashboards should track backlog, oldest pending age, retry/dead counts, and delivery latency.
- Add local OSS stack:
  - Extend Compose with Grafana, Loki, Prometheus, Tempo, Alloy.
  - Provision Grafana datasources and one reliability dashboard.
  - Use Grafana Alloy, not Promtail, because Grafana docs mark Promtail deprecated/LTS/EOL around 2026.
- Add `.docs/architecture/observability.md`:
  - Record decision: hybrid scrape + OTLP.
  - Logs: JSON stdout -> Alloy -> Loki.
  - Metrics: `/metrics` -> Prometheus.
  - Traces: OTLP -> Alloy/Tempo.
  - Rationale and tradeoffs vs all-OTLP and logs-only.
  - Domain events vs logs distinction.
  - Worker naming convention.

## Dashboard V1

- Reliability ops dashboard only:
  - HTTP request volume, status/error rate, p95 latency.
  - Discord interaction volume, outcome/error rate, p95 latency.
  - DB health probe status/latency.
  - Lifecycle worker runs, failures, and void counts.
  - Future event-delivery backlog and retry panels.
  - Recent error logs with request/interaction IDs.
  - Trace drilldown links from logs where supported.

## Tests

- Add unit tests for logger JSON shape, level filtering, redaction, and wide-event completion.
- Add server tests for request ID propagation, `/metrics`, success/error request logging behavior.
- Add bot handler tests for interaction wide-event fields without logging sensitive Discord data.
- Add worker tests for lifecycle run logs/metrics.
- Required completion checks: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`.

## Assumptions

- V1 targets local/dev observability first; production retention, auth, backups, and HA are out of scope.
- `LOG_LEVEL` remains existing env control; add only minimal new env such as `SERVICE_NAME`, `COMMIT_HASH`, and OTLP endpoint if needed.
- Dashboard uses explicit LGTM services instead of single `grafana/otel-lgtm` image for transparent config.
- Do not implement `event_deliveries` until separately requested; only reserve observability shape now.
- Official references for implementation choices: [Grafana Alloy Docker monitoring](https://grafana.com/docs/alloy/latest/monitor/monitor-docker-containers/), [Loki Docker install](https://grafana.com/docs/loki/latest/setup/install/docker/), [Tempo Docker Compose](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/docker-compose/), [OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/).
