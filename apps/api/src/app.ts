import { profileUpdate, type Profile } from '@splity/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Auth } from './auth';
import type { Db } from './db/client';
import { users } from './db/schema';

type Env = { Variables: { userId: string } };

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Which sign-in methods are configured, for the sign-in screen. */
  features: { google: boolean };
}

/** Runtime-agnostic app: served by src/server.ts locally, by a Vercel function in production. */
export function createApp({ db, auth, features }: AppDeps) {
  const app = new Hono<Env>().basePath('/api');

  const requireUser = createMiddleware<Env>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'unauthenticated' }, 401);
    c.set('userId', session.user.id);
    await next();
  });

  const profileOf = async (userId: string): Promise<Profile | undefined> => {
    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        photoUrl: users.photoUrl,
        upiId: users.upiId,
        defaultCurrency: users.defaultCurrency,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  };

  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/config', (c) => c.json(features));

  app.get('/me', requireUser, async (c) => {
    const profile = await profileOf(c.var.userId);
    return profile ? c.json(profile) : c.json({ error: 'unauthenticated' }, 401);
  });

  app.patch('/me', requireUser, async (c) => {
    const parsed = profileUpdate.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
    const { displayName, upiId, defaultCurrency } = parsed.data;
    await db
      .update(users)
      .set({
        ...(displayName !== undefined && { displayName }),
        ...(upiId !== undefined && { upiId }),
        ...(defaultCurrency !== undefined && { defaultCurrency }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, c.var.userId));
    return c.json(await profileOf(c.var.userId));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
