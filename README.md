# Splity

Expense sharing for a group of friends. Planning docs: [SPEC](docs/SPEC.md) · [DATA_MODEL](docs/DATA_MODEL.md) ·
[TECH_STACK](docs/TECH_STACK.md) · [SCREENS](docs/SCREENS.md) · [DESIGN](docs/DESIGN.md).

## Layout

| Path | What |
|---|---|
| `packages/shared` | Money logic shared by browser and server: parsing/formatting, FX, splits, balances, debt simplification |
| `apps/api` | Hono API (Node locally, Vercel Functions in production) |
| `apps/web` | React + Vite PWA |

## Database

Local PGlite (embedded PostgreSQL) in `apps/api/.data/`, git-ignored. Schema changes:
edit `apps/api/src/db/schema.ts`, then `pnpm --filter @splity/api db:generate --name=<change>`.
Rules Drizzle can't express go in a custom migration (`db:custom --name=<change>`).

## Commands

Requires Node 22+ and pnpm 10.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm test          # all packages
pnpm typecheck
pnpm --filter @splity/api db:migrate   # create/upgrade the local PGlite database in apps/api/.data
pnpm dev:api       # http://localhost:8787/api/health
pnpm dev:web       # http://localhost:3000 (proxies /api to the API)
```

Sign in locally with any email: the magic link is printed in the `dev:api` console. Google
sign-in turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
`GOOGLE_REDIRECT_URI` (here `http://localhost:3000`) must match the OAuth client's authorized
redirect URI exactly; Google returns to the app root and the web app forwards to the API callback.
