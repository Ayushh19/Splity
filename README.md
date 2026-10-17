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

Local PGlite (embedded PostgreSQL) in `apps/api/.data/`, git-ignored; production uses Neon
(`DATABASE_URL`). Schema changes:
edit `apps/api/src/db/schema.ts`, then `pnpm --filter @splity/api db:generate --name=<change>`.
Rules Drizzle can't express go in a custom migration (`db:custom --name=<change>`).

## Commands

Requires Node 22+ and pnpm 10.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env   # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm test          # all packages
pnpm typecheck
pnpm --filter @splity/api db:migrate   # create/upgrade the local PGlite database (or DATABASE_URL)
pnpm dev:api       # http://localhost:8787/api/health
pnpm dev:web       # http://localhost:3000 (proxies /api to the API)
```

Push notifications need VAPID keys in `apps/api/.env` (see `.env.example`); push works on
`http://localhost` in Chrome/Firefox. To test on a phone, the app must be served over HTTPS.

Sign in locally with any email: the magic link is printed in the `dev:api` console. Google
sign-in turns on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
`GOOGLE_REDIRECT_URI` (here `http://localhost:3000`) must match the OAuth client's authorized
redirect URI exactly; Google returns to the app root and the web app forwards to the API callback.

To run the API tests against a real PostgreSQL server instead of PGlite (wipes its `public` schema):
`TEST_DATABASE_URL=postgres://… pnpm --filter @splity/api test:pg`.

## Deploying (Vercel + Neon)

`pnpm vercel-build` builds the web app and bundles the API into one Vercel Function, written as
`.vercel/output` (routing, SPA fallback and the daily recurring-expense cron are in
`scripts/build-vercel.mjs`). Production builds run the database migrations first.

1. **Neon** (free): create a project in a region near your users (e.g. Singapore) and copy the
   *pooled* connection string.
2. **Vercel** (Hobby): import the GitHub repo with the root directory left as the repo root;
   `vercel.json` sets the install and build commands. Add environment variables (Production):
   `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (`https://<project>.vercel.app`),
   `CRON_SECRET` (random), `APP_TIMEZONE`, and optionally Google, Resend and VAPID keys.
   Pick the Functions region next to the Neon region.
3. **Google sign-in**: add `https://<project>.vercel.app/api/auth/callback/google` as an
   authorized redirect URI (leave `GOOGLE_REDIRECT_URI` unset), and publish the OAuth consent
   screen or add friends as test users.
4. **Magic links for friends** need a domain verified in Resend and `EMAIL_FROM` on it.
5. On the phone: open the URL, then *Add to Home Screen*. On iOS, push only works from the
   installed app, and a magic link opens in Safari (not the installed app), so prefer Google there.
