import {
  formatAmount,
  muteInput,
  pushSubscriptionInput,
  REMINDER_COOLDOWN_MS,
  reminderInput,
  unsubscribeInput,
  type ReminderResult,
  type ReminderView,
} from '@splity/shared';
import { and, desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db } from '../db/client';
import { groupMembers, pushSubscriptions, reminders, users } from '../db/schema';
import { body, HttpError, requireUser, type AppEnv } from '../http';
import { groupBalances, owedBetween } from '../services/balances';
import { assertWritable, effectiveName, getGroup, getMemberInGroup, requireMember } from '../services/membership';
import type { Notifier } from '../services/push';
import { groupDetail } from './groups';

export interface NotificationRouteDeps {
  db: Db;
  auth: Auth;
  notifier: Notifier;
  baseUrl: string;
}

/** Mounted at /push: this device's subscription for the signed-in user. */
export function pushRoutes({ db, auth }: Pick<NotificationRouteDeps, 'db' | 'auth'>) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  /** Save (or move to this user) a browser push subscription. */
  app.post('/subscriptions', async (c) => {
    const { endpoint, keys } = await body(c, pushSubscriptionInput);
    await db
      .insert(pushSubscriptions)
      .values({ userId: c.var.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // A device signing into another account must stop receiving the old account's pushes.
        set: { userId: c.var.userId, p256dh: keys.p256dh, auth: keys.auth },
      });
    return c.body(null, 204);
  });

  app.post('/subscriptions/remove', async (c) => {
    const { endpoint } = await body(c, unsubscribeInput);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, c.var.userId)));
    return c.body(null, 204);
  });

  return app;
}

/** Mounted at /groups/:groupId: mute and reminders. */
export function groupNotificationRoutes({ db, auth, notifier, baseUrl }: NotificationRouteDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  app.put('/mute', async (c) => {
    const groupId = c.req.param('groupId')!;
    const { muted } = await body(c, muteInput);
    const me = await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const [updated] = await db.update(groupMembers).set({ muted }).where(eq(groupMembers.id, me.id)).returning();
    return c.json(await groupDetail(db, await getGroup(db, groupId), updated!, baseUrl));
  });

  /** Reminders I sent in this group during the last 24 hours (for "reminded 3h ago"). */
  app.get('/reminders', async (c) => {
    const groupId = c.req.param('groupId')!;
    const me = await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const rows = await db
      .select({ toMember: reminders.toMember, sentAt: reminders.sentAt })
      .from(reminders)
      .where(
        and(
          eq(reminders.groupId, groupId),
          eq(reminders.fromMember, me.id),
          gt(reminders.sentAt, new Date(Date.now() - REMINDER_COOLDOWN_MS)),
        ),
      )
      .orderBy(desc(reminders.sentAt));
    const latest = new Map<string, ReminderView>();
    for (const r of rows) if (!latest.has(r.toMember)) latest.set(r.toMember, { toMember: r.toMember, sentAt: r.sentAt.toISOString() });
    return c.json([...latest.values()]);
  });

  /**
   * Remind someone who owes you. Once per pair per 24 h. Delivered even if they
   * muted the group (it's a direct, rate-limited nudge). Not recorded when they
   * have no device with notifications on, so the 24 h window isn't wasted.
   */
  app.post('/reminders', async (c) => {
    const groupId = c.req.param('groupId')!;
    const { toMember } = await body(c, reminderInput);
    const me = await requireMember(db, groupId, c.var.userId);
    const group = await getGroup(db, groupId);
    assertWritable(group);
    const target = await getMemberInGroup(db, groupId, toMember);
    if (!target.userId) throw new HttpError(400, 'invalid', "Placeholders don't have an account to remind");

    const owed = owedBetween(await groupBalances(db, groupId), target.id, me.id);
    if (owed <= 0) throw new HttpError(400, 'invalid', "They don't owe you anything here");

    const [recent] = await db
      .select({ sentAt: reminders.sentAt })
      .from(reminders)
      .where(
        and(
          eq(reminders.groupId, groupId),
          eq(reminders.fromMember, me.id),
          eq(reminders.toMember, target.id),
          gt(reminders.sentAt, new Date(Date.now() - REMINDER_COOLDOWN_MS)),
        ),
      )
      .limit(1);
    if (recent) {
      const retryAt = new Date(recent.sentAt.getTime() + REMINDER_COOLDOWN_MS).toISOString();
      throw new HttpError(429, 'rate_limited', 'You already reminded them in the last 24 hours', { retryAt });
    }

    if ((await notifier.deviceCount(target.userId)) === 0) {
      return c.json({ delivered: false, reminder: null } satisfies ReminderResult);
    }

    const [row] = await db.insert(reminders).values({ groupId, fromMember: me.id, toMember: target.id }).returning();
    const [sender] = await db
      .select({ name: effectiveName })
      .from(groupMembers)
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.id, me.id));
    const reached = await notifier.remind(target.userId, {
      title: group.name,
      body: `${sender?.name ?? 'A friend'} reminds you: you owe them ${formatAmount(owed, group.currency)}.`,
      url: `/groups/${groupId}?tab=balances`,
      tag: `reminder-${groupId}-${me.id}`,
    });
    if (reached === 0) {
      // Every subscription turned out to be dead: don't hold the 24 h slot.
      await db.delete(reminders).where(eq(reminders.id, row!.id));
      return c.json({ delivered: false, reminder: null } satisfies ReminderResult);
    }
    return c.json({ delivered: true, reminder: { toMember: target.id, sentAt: row!.sentAt.toISOString() } } satisfies ReminderResult);
  });

  return app;
}
