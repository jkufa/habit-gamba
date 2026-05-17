# Observability

Habit Gamba uses a local OSS Grafana LGTM stack for development observability:

- Grafana for dashboards.
- Loki for JSON stdout logs.
- Prometheus for metrics.
- Tempo for traces.
- Grafana Alloy for Docker log collection and OTLP trace forwarding.

## Telemetry Path

V1 uses a hybrid scrape and OTLP design.

- Logs: apps emit structured JSON to stdout. Alloy forwards container stdout logs to Loki when services run in Docker.
- Metrics: server exposes `/metrics`; bot can expose metrics when `BOT_METRICS_PORT` is set. Prometheus scrapes both.
- Traces: apps export OTLP HTTP traces to `OTEL_EXPORTER_OTLP_ENDPOINT`, normally `http://localhost:4318`.

This keeps local Prometheus behavior explicit while using the standard OTLP path for traces.

## Service Names

Use stable `service` labels in every log line, metric, and trace:

- `server`
- `bot`
- `market-lifecycle-worker`
- `event-worker` for the future event delivery worker

The current lifecycle worker owns scheduled market maintenance only. Event delivery will be a separate worker so Discord retries and backlog do not mix with lifecycle maintenance.

## Domain Events vs Logs

The `events` table is durable domain/outbox state. It records business events such as `market.resolved` and `market.voided` inside the same transaction as the state transition.

Loki logs are operational telemetry. They are ephemeral, queryable records for debugging latency, failures, retries, and request/interaction context. Do not use Loki logs as durable business state.

When a domain event is inserted, app code emits an operational `event_inserted` log with internal IDs only: `event_id`, `event_type`, `aggregate_type`, and `aggregate_id`.

## Event Deliveries

`event_deliveries` is intentionally not implemented yet. When added, it should support reliable async side effects:

- first sink: `discord`
- delivery statuses: pending, processing, delivered, failed, dead
- retry fields: attempts, next_attempt_at, locked_until, delivered_at, last_error
- uniqueness: one delivery row per `(event_id, sink)`

Dashboard panels should track pending deliveries, oldest pending age, retry counts, dead deliveries, and delivery latency.

## Local Stack

Start the stack with:

```bash
docker compose up -d postgres grafana loki prometheus tempo alloy
```

Grafana runs at `http://localhost:3002`.

For traces from locally running apps, set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

For bot metrics, set:

```bash
BOT_METRICS_PORT=3001
```
