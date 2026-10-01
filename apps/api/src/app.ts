import { profileUpdate, type Profile } from '@splity/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Auth } from './auth';
import type { Db } from './db/client';
import { users } from './db/schema';
import { body, HttpError, requireUser, type AppEnv } from './http';
import { expenseRoutes } from './routes/expenses';
import { groupRoutes } from './routes/groups';
import { settlementRoutes } from './routes/settlements';
import { inviteRoutes } from './routes/invites';

export interface AppDeps {
  db: Db;
  auth: Auth;
  /** Public origin of the app, used to build invite links. */
  baseUrl: string;
  /** Which sign-in methods are configured, for the sign-in screen. */
  features: { google: boolean };
}

/** Runtime-agnostic app: served by src/server.ts locally, by a Vercel function in production. */
export function createApp({ db, auth, baseUrl, features }: AppDeps) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ ...err.details, error: err.code, message: err.message }, err.status);
    }
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: 'internal', message: 'Something went wrong' }, 500);
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

  app.get('/me', requireUser(auth), async (c) => {
    const profile = await profileOf(c.var.userId);
    if (!profile) throw new HttpError(401, 'unauthenticated');
    return c.json(profile);
  });

  app.patch('/me', requireUser(auth), async (c) => {
    const { displayName, upiId, defaultCurrency } = await body(c, profileUpdate);
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

  app.route('/groups', groupRoutes({ db, auth, baseUrl }));
  app.route('/groups/:groupId', expenseRoutes({ db, auth }));
  app.route('/groups/:groupId', settlementRoutes({ db, auth }));
  app.route('/invites', inviteRoutes({ db, auth, baseUrl }));

  return app;
}

export type App = ReturnType<typeof createApp>;
