/**
 * Vercel Function entry (Node runtime). Bundled by scripts/build-vercel.mjs into
 * .vercel/output/functions/api.func; every /api/* request is routed here with its original URL.
 * The recurring job runs from Vercel Cron (GET /api/cron/recurring), not a timer.
 */
import { getRequestListener } from '@hono/node-server';
import { loadConfig } from './config';
import { createMainApp } from './main';

const { app } = await createMainApp(loadConfig());

export default getRequestListener(app.fetch);
