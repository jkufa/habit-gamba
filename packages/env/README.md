# `@habit-gamba/env`

Shared Zod env parsing. Database-backed services use `loadBaseEnv` or
`loadServerEnv`; bot runtime uses `loadBotRuntimeEnv` and does not require direct
database access.
