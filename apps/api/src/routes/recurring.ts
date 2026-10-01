import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db } from '../db/client';
import { recurringSeries } from '../db/schema';
import { HttpError, notFound, requireUser, type AppEnv } from '../http';
import { logActivity } from '../services/activity';
import { assertWritable, lockGroup, requireMember } from '../services/membership';
import { resumeSeries, seriesViews, type RecurringJob } from '../services/recurring';

export interface RecurringRouteDeps {
  db: Db;
  auth: Auth;
  recurring: RecurringJob;
  today: () => string;
}

/** Mounted at /groups/:groupId. Any active member can pause, resume or stop a series. */
export function recurringRoutes({ db, auth, recurring, today }: RecurringRouteDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  app.get('/recurring', async (c) => {
    const groupId = c.req.param('groupId')!;
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    return c.json(await seriesViews(db, groupId));
  });

  for (const action of ['pause', 'resume', 'stop'] as const) {
    app.post(`/recurring/:seriesId/${action}`, async (c) => {
      const { groupId, seriesId } = c.req.param() as { groupId: string; seriesId: string };
      await db.transaction(async (tx) => {
        const me = await requireMember(tx, groupId, c.var.userId);
        const group = await lockGroup(tx, groupId);
        assertWritable(group);
        const [series] = await tx
          .select()
          .from(recurringSeries)
          .where(and(eq(recurringSeries.id, seriesId), eq(recurringSeries.groupId, groupId)));
        if (!series) throw notFound();
        if (series.status === 'stopped') throw new HttpError(409, 'conflict', 'This series was stopped');

        if (action === 'pause') {
          if (series.status !== 'active') return;
          await tx.update(recurringSeries).set({ status: 'paused', pausedReason: 'manual' }).where(eq(recurringSeries.id, seriesId));
        } else if (action === 'resume') {
          if (series.status === 'active') return;
          await resumeSeries(tx, group, series, today());
        } else {
          await tx.update(recurringSeries).set({ status: 'stopped', pausedReason: null }).where(eq(recurringSeries.id, seriesId));
        }
        const [view] = await seriesViews(tx, groupId, [seriesId]);
        await logActivity(tx, {
          groupId,
          actorMember: me.id,
          type: action === 'pause' ? 'recurring.paused' : action === 'resume' ? 'recurring.resumed' : 'recurring.stopped',
          entityType: 'group',
          entityId: groupId,
          payload: { description: view?.latest?.description ?? '', reason: action === 'pause' ? 'manual' : undefined },
        });
      });
      // Resuming on a due date creates today's occurrence right away.
      if (action === 'resume') await recurring.runDue(today(), groupId);
      const [view] = await seriesViews(db, groupId, [seriesId]);
      return c.json(view);
    });
  }

  return app;
}
