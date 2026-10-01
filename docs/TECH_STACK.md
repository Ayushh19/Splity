# Splity — Tech Stack (v1)

Constraint: TypeScript everywhere, React frontend, Node backend, PostgreSQL, **free tiers only**.
Free-tier limits verified October 2026.

## Overview

| Layer | Choice |
|---|---|
| Repo | pnpm workspaces monorepo: `apps/web`, `apps/api`, `packages/shared` |
| Frontend | React + Vite + TypeScript, `vite-plugin-pwa` |
| Routing | React Router (library mode) |
| Server state | TanStack Query |
| Styling | Plain CSS with custom properties generated from `docs/DESIGN.md` tokens (`apps/web/src/styles/`); Lucide icons; self-hosted VT323 + JetBrains Mono via Fontsource |
| Validation | Zod (in `packages/shared`, used by both web and api) |
| Backend | Node + TypeScript, **Hono**, deployed as Vercel Functions (Node runtime) |
| Database access | **Drizzle ORM** + hand-written SQL migrations for triggers/partial indexes |
| Database | **PGlite** (PostgreSQL compiled to WASM, embedded in Node, data in a local folder) for development. **Production database: not decided yet** |
| Auth | **Better Auth 1.7** — Google OAuth + email magic link, using our `users` table (`usePlural`, UUID ids) plus `sessions`, `accounts`, `verifications`. 60-day sessions, single-use hashed magic links valid 10 min, Google and magic link for the same email share one account. Origin checks forced on even under `NODE_ENV=test` |
| Email | **Resend** (magic links only), optional: without `RESEND_API_KEY` links are printed in the API console |
| Push | Web Push via `web-push` + VAPID keys |
| Receipts | **Cloudflare R2**, browser uploads directly via presigned URL |
| Scheduled jobs | **Vercel Cron**, once daily (recurring expenses) |
| Hosting | **Vercel Hobby** — static frontend + API functions in one project |

## `packages/shared` — the most important package

Code that **must** behave identically in the browser (live preview while entering an expense)
and on the server (the authoritative write):

- Money helpers: minor-unit conversion per ISO 4217 exponent, formatting, FX rounding (half-up).
- Split algorithm: equal / exact / shares → `owed_minor` with leftover units by `sort_key`.
- Per-expense minimal transfers (raw "who owes whom").
- Debt simplification over net balances — **greedy**: repeatedly match the largest debtor with the
  largest creditor (ties broken by `sort_key`). At most n−1 payments, deterministic, fast at 50
  members. Not guaranteed minimal; revisit only if it produces visibly silly results.
- Zod schemas for every API request/response.

All of it pure functions, no I/O, heavily unit-tested (including property tests: splits always
sum to the total, nets always sum to zero).

## Why these choices

- **Vercel over an always-on free server (Render etc.):** free always-on servers sleep and take
  30–60 s to wake; serverless cold starts are ~1 s. Hono keeps the API portable if we ever move.
- **Drizzle over Prisma:** the model relies on partial unique indexes, deferred constraint
  triggers and `UPDATE … WHERE version = $seen` optimistic locking — Drizzle stays close to SQL.
- **Vite SPA over Next.js:** no SSR needed; a plain SPA is the simplest PWA.
- **PGlite for development (decided 2026-10-01):** no hosted database for now. PGlite is real
  PostgreSQL, so the schema, partial indexes, enums and constraint triggers work unchanged, and the
  same Drizzle migrations will run on any PostgreSQL server later. Limitation: one process opens
  the data folder at a time.
- **Production database is open.** Vercel functions cannot reach a database on a local machine,
  so before deploying we must pick either a hosted PostgreSQL (Neon, Supabase, …) or self-hosting
  the API next to the database (always-on Node server + a tunnel), which would replace Vercel.

## Free-tier limits and how we fit

| Service | Free limit | Our usage / mitigation |
|---|---|---|
| Vercel Hobby | **Non-commercial use only.** Functions max 300 s. Cron at most **once per day**, fires anywhere within the scheduled hour, UTC | Friends app = non-commercial. Recurring job runs daily ~00:30 IST (19:00 UTC); handlers stay well under 300 s |
| Resend | 100 emails/day, 3,000/month | Magic links only; Google is the primary sign-in |
| Cloudflare R2 | 10 GB storage, 1M writes, 10M reads/month, free egress | Compress receipts in the browser to ~1600 px JPEG (~300–500 KB) before upload → ~20k+ receipts. Cloudflare may require a payment method on file to enable R2 |
| Web Push | Free (browser vendors' push services) | — |

## Notes for implementation

- **Cron timing:** Vercel Hobby fires within the hour and only once a day, so occurrence creation
  must be idempotent (already guaranteed by `UNIQUE (recurring_series_id, occurrence_date)`) and
  must create *all* series due on or before today, not just "exactly today".
- **Push on iOS** only works once the PWA is added to the home screen (iOS 16.4+); the app should
  prompt iOS users to install it.
- **Secrets:** Google OAuth client, Better Auth secret, VAPID keys, R2 keys, Resend key, database URL —
  all as Vercel environment variables, never in the repo.
