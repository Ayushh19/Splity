/**
 * Vercel Function entry (Node runtime). Bundled by scripts/build-vercel.mjs into
 * .vercel/output/functions/api.func; every /api/* request is routed here with its original URL.
 * The recurring job runs from Vercel Cron (GET /api/cron/recurring), not a timer.
 */
import { getRequestListener } from '@hono/node-server';
import { waitUntil } from '@vercel/functions';
import { loadConfig } from './config';
import { createMainApp } from './main';

const { app, notifier } = await createMainApp(loadConfig());

export default getRequestListener(async (request) => {
  const response = await app.fetch(request);
  // Push notifications are sent after the response; keep the function alive until they're out,
  // or Vercel may freeze it first and the pushes are lost.
  waitUntil(notifier.idle());
  return response;
});
