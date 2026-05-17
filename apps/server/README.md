# `@habit-gamba/server`

Hono API server for Habit Gamba. It owns HTTP health checks and will stay thin, delegating business behavior to domain packages.

## API auth

Write endpoints currently trust bot/dev identity headers:

- `X-Provider`
- `X-Provider-User-Id`

The server maps those headers to an existing active user and rejects missing or unknown users. It does not create users from API auth.

This is temporary for the proof of concept. Before exposing web or mobile clients, replace the header parser with bearer-token verification that validates issuer, audience, expiry, and maps token claims into the same internal provider identity.

## Response shape

Successful responses use `{ "data": ... }`. Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. Bigint micro amounts are encoded as decimal strings.
