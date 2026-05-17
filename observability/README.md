# Observability Stack

Local OSS observability stack for Habit Gamba:

- Grafana: dashboards
- Loki: JSON stdout logs
- Prometheus: metrics
- Tempo: traces
- Grafana Alloy: Docker log collection and OTLP forwarding

## Purpose

This stack makes local and staging behavior inspectable without adding a paid observability vendor.
It should answer operational questions quickly:

- Is the API healthy, and which routes are failing?
- Are Discord interactions failing or slowing down?
- Did the market lifecycle worker run, and how many markets did it void?
- Did domain events get inserted when markets resolve or void?
- Can a request, Discord interaction, worker run, or domain event be correlated through logs and traces?

The stack is deliberately split by telemetry type:

- Logs explain what happened with rich request, interaction, worker, and event context.
- Metrics show rates, error counts, latency, and worker outcomes over time.
- Traces connect work across service boundaries when a request or job spans multiple operations.

The database `events` table is not a log store. It is durable domain/outbox state. Loki logs are
operational telemetry and can be discarded without losing product state.

## Start

```bash
docker compose up -d postgres grafana loki prometheus tempo alloy
```

Grafana runs at:

```text
http://localhost:3002
```

The provisioned dashboard is in Grafana folder `Habit Gamba`:

```text
Habit Gamba Reliability
```

## Run Apps With Telemetry

Server metrics are exposed at `/metrics` on the API server.

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun --env-file=.env apps/server/src/index.ts
```

Bot metrics are optional because the bot is not an HTTP service by default. Set `BOT_METRICS_PORT`
when running the bot so Prometheus can scrape it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
BOT_METRICS_PORT=3001 \
bun --env-file=.env --env-file=apps/bot/.env apps/bot/src/index.ts
```

The market lifecycle worker emits logs, metrics in-process, and traces for each run:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun --env-file=.env apps/market-lifecycle-worker/src/index.ts
```

## Endpoints

- Grafana UI: `http://localhost:3002`
- Prometheus UI: `http://localhost:9090`
- Loki API: `http://localhost:3100`
- Tempo API: `http://localhost:3200`
- Alloy OTLP HTTP ingest: `http://localhost:4318`
- Alloy OTLP gRPC ingest: `localhost:4317`
- Server metrics: `http://localhost:3000/metrics`
- Bot metrics: `http://localhost:3001` when `BOT_METRICS_PORT=3001`

Grafana and Prometheus have browser UIs. Loki, Tempo, and Alloy OTLP ports are APIs or ingestion
ports, so opening their roots in a browser may show `404` or an unavailable page. That is expected.

Useful health checks:

```bash
curl http://localhost:3100/ready
curl http://localhost:3200/ready
curl http://localhost:4318
```

The Alloy OTLP HTTP root can return `404`; traces are sent with `POST /v1/traces`. The OTLP gRPC
port is not a browser endpoint.

## Logs

Apps emit JSON logs to stdout. When apps run as Docker containers, Alloy reads Docker logs and
pushes them to Loki. When apps run directly on the host, their stdout is visible in the terminal;
Loki collection requires running them in containers or adding host file/stdout collection.

## Metrics

Prometheus scrapes:

- `host.docker.internal:3000/metrics` for server metrics
- `host.docker.internal:3001/` for bot metrics when enabled

If Prometheus cannot scrape host apps, verify the app is running and the port matches
[prometheus.yml](/Users/jkufa/Octokitty/habit-gamba/observability/prometheus/prometheus.yml).

## Traces

Apps export OTLP HTTP traces to Alloy at:

```text
http://localhost:4318/v1/traces
```

Set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Alloy forwards traces to Tempo.

## Stop

```bash
docker compose down
```

To remove persisted Grafana/Loki/Prometheus/Tempo data:

```bash
docker compose down -v
```

## Troubleshooting

Check containers:

```bash
docker compose ps
```

Check stack logs:

```bash
docker compose logs -f grafana loki prometheus tempo alloy
```

Validate Compose config:

```bash
docker compose config --quiet
```
