# Deployment

Habit Gamba deploys to Railway from GitHub after CI passes. Railway builds every
service from the root `Dockerfile`; each service uses its own Railway start
command.

## GitHub Setup

- Add required branch checks for `CI`.
- Enable the `Discord Commands` workflow. It deploys staging guild commands on
  command changes to `main`; production global command deploy is manual and uses
  the `production` environment approval.
- Add GitHub Environments:
  - `staging` with secrets `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, and
    `DISCORD_DEV_GUILD_ID`.
  - `production` with required reviewers and secrets `DISCORD_APPLICATION_ID`
    and `DISCORD_BOT_TOKEN`.

## Railway Setup

- Create one Railway project with `staging` and `production` environments.
- In each environment, create managed Postgres and these repo-backed services:
  - `api-server`
  - `discord-bot`
  - `event-worker`
  - `market-lifecycle-worker`
  - `market-reminder-worker`
- Point each service at this GitHub repo and leave root directory as `/`.
- Use the root `Dockerfile` for all services.
- Configure service settings from `deploy/components.json`.
- Generate a public domain only for `api-server`.
- Set `discord-bot` `API_BASE_URL` to the private Railway URL:

```txt
http://${{api-server.RAILWAY_PRIVATE_DOMAIN}}:${{api-server.PORT}}
```

## Service Settings

`api-server`:

```txt
Start command: bun --filter @habit-gamba/server start
Pre-deploy command: bun --filter @habit-gamba/db db:migrate
Healthcheck path: /health/db
Restart policy: ON_FAILURE
```

`discord-bot`:

```txt
Start command: bun --filter @habit-gamba/bot start
Restart policy: ON_FAILURE
Public networking: disabled
```

`event-worker`:

```txt
Start command: bun --filter @habit-gamba/event-worker start
Restart policy: ON_FAILURE
Public networking: disabled
```

`market-lifecycle-worker`:

```txt
Start command: bun --filter @habit-gamba/market-lifecycle-worker start
Cron schedule: 59 3 * * *
Restart policy: NEVER
Public networking: disabled
```

`market-reminder-worker`:

```txt
Start command: bun --filter @habit-gamba/market-reminder-worker start
Cron schedule: */5 * * * *
Restart policy: NEVER
Public networking: disabled
```

Railway cron is UTC and does not support seconds. `59 3 * * *` is the fixed UTC
compromise for 23:59 New York during EDT; during EST it runs at 22:59 New York.
The reminder worker runs every 5 minutes and sends due rows using stored UTC
times.

## Environment Variables

Set these on services that need them:

```txt
BOT_API_TOKEN=<shared secret between bot and api-server>
DATABASE_URL=${{Postgres.DATABASE_URL}}
LOG_LEVEL=info
NODE_ENV=production
```

`api-server` needs `BOT_API_TOKEN` and `DATABASE_URL`. Railway provides `PORT`.
Do not hard-code `SERVER_PORT` unless you need to override it.

`event-worker` needs `DATABASE_URL` and `DISCORD_BOT_TOKEN`.

`market-lifecycle-worker` needs `DATABASE_URL`.

`market-reminder-worker` needs `DATABASE_URL` and `DISCORD_BOT_TOKEN`.

`discord-bot` needs `BOT_API_TOKEN`, but it does not need direct database
access.

For `discord-bot` staging:

```txt
API_BASE_URL=http://${{api-server.RAILWAY_PRIVATE_DOMAIN}}:${{api-server.PORT}}
DISCORD_APPLICATION_ID=<staging app id>
DISCORD_BOT_TOKEN=<staging bot token>
DISCORD_DEV_GUILD_ID=<staging guild id>
```

For `discord-bot` production:

```txt
API_BASE_URL=http://${{api-server.RAILWAY_PRIVATE_DOMAIN}}:${{api-server.PORT}}
DISCORD_APPLICATION_ID=<production app id>
DISCORD_BOT_TOKEN=<production bot token>
```

Production bot runtime does not require `DISCORD_DEV_GUILD_ID`.

Optional worker setting:

```txt
MARKET_LIFECYCLE_BATCH_LIMIT=100
MARKET_REMINDER_BATCH_LIMIT=100
MARKET_REMINDER_LOCK_TTL_MS=60000
```

## Slash Commands

Staging guild command deploy:

```sh
bun --filter @habit-gamba/bot deploy:commands
```

Production global command deploy:

```sh
bun --filter @habit-gamba/bot deploy:commands -- --global
```

## Local Worker Run

Run scheduled workers manually against local Postgres:

```sh
bun --filter @habit-gamba/market-lifecycle-worker start
bun --filter @habit-gamba/market-reminder-worker start
```

Run the event delivery worker locally:

```sh
bun --filter @habit-gamba/event-worker start
```
