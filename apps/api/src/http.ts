import type { ApiErrorCode } from '@splity/shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { Auth } from './auth';

export type AppEnv = { Variables: { userId: string } };

/** Thrown from handlers/services; turned into `{ error, message }` JSON by the app's error handler. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message?: string,
    /** Extra fields merged into the JSON body (e.g. validation issues, the current version on conflict). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const notFound = () => new HttpError(404, 'not_found');
export const forbidden = (message?: string) => new HttpError(403, 'forbidden', message);

export function requireUser(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HttpError(401, 'unauthenticated');
    c.set('userId', session.user.id);
    await next();
  });
}

/** Parse and validate a JSON body, or throw a 400 with the Zod issues. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    throw new HttpError(400, 'invalid', parsed.error.issues[0]?.message, { issues: parsed.error.issues });
  }
  return parsed.data;
}
