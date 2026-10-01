import { Hono } from 'hono';

// Runtime-agnostic app: served by src/server.ts locally and by a Vercel function in production.
export const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' }));
