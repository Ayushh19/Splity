import { expenseInput, expenseUpdate, versionBody, type ExpenseDetail, type ExpenseSnapshot } from '@splity/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { expenses, groupMembers, revisions, users } from '../db/schema';
import { body, HttpError, requireUser, type AppEnv } from '../http';
import {
  loadExpense,
  loadExpenses,
  prepareExpense,
  recordChange,
  writeLines,
} from '../services/expenses';
import { groupBalances } from '../services/balances';
import { assertWritable, effectiveName, lockGroup, requireMember } from '../services/membership';
import type { Notifier } from '../services/push';
import { createSeries, type RecurringJob } from '../services/recurring';

export interface ExpenseRouteDeps {
  db: Db;
  auth: Auth;
  notifier: Notifier;
  recurring: RecurringJob;
  /** Today's date in the app time zone. */
  today: () => string;
}

/**
 * Someone else saved first: reply 409 with the current state so the client can
 * show "<name> changed this while you were editing" and the diff.
 */
async function conflict(db: DbOrTx, groupId: string, expenseId: string): Promise<HttpError> {
  const current = await loadExpense(db, groupId, expenseId);
  const [last] = await db
    .select({ actorName: effectiveName })
    .from(revisions)
    .leftJoin(groupMembers, eq(groupMembers.id, revisions.actorMember))
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(revisions.entityType, 'expense'), eq(revisions.entityId, expenseId), eq(revisions.version, current.version)));
  const who = last?.actorName ?? 'Someone';
  return new HttpError(409, 'conflict', `${who} changed this expense while you were editing`, { current, changedBy: who });
}

/** Mounted at /groups/:groupId. */
export function expenseRoutes({ db, auth, notifier, recurring, today }: ExpenseRouteDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  app.get('/expenses', async (c) => {
    const groupId = c.req.param('groupId')!;
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const deleted = c.req.query('deleted') === '1';
    return c.json(await loadExpenses(db, groupId, { deleted }));
  });

  app.post('/expenses', async (c) => {
    const groupId = c.req.param('groupId')!;
    const input = await body(c, expenseInput);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const prepared = await prepareExpense(tx, group, input);
      const series = input.repeat ? await createSeries(tx, groupId, input.repeat.frequency, input.expenseDate, today(), me.id) : null;
      const [row] = await tx
        .insert(expenses)
        .values({
          groupId,
          createdBy: me.id,
          recurringSeriesId: series?.id ?? null,
          occurrenceDate: series ? input.expenseDate : null,
          description: input.description,
          category: input.category,
          notes: input.notes,
          expenseDate: input.expenseDate,
          splitMethod: input.split.method,
          amountMinor: prepared.amountMinor,
          originalCurrency: prepared.originalCurrency,
          originalAmountMinor: prepared.originalAmountMinor,
          fxRate: prepared.fxRate,
        })
        .returning({ id: expenses.id });
      await writeLines(tx, row!.id, prepared);
      const view = await loadExpense(tx, groupId, row!.id);
      return { view, activityId: await recordChange(tx, group, view, 'create', me.id) };
    });
    notifier.activity(view.activityId);
    // A first date in the past may already make the next occurrence due today.
    if (input.repeat) void recurring.runDue(today(), groupId).catch((e) => console.error('[recurring]', e));
    return c.json(view.view, 201);
  });

  app.get('/expenses/:expenseId', async (c) => {
    const { groupId, expenseId } = c.req.param() as { groupId: string; expenseId: string };
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const expense = await loadExpense(db, groupId, expenseId);
    const history = await db
      .select({
        version: revisions.version,
        action: revisions.action,
        actorName: effectiveName,
        createdAt: revisions.createdAt,
        snapshot: revisions.snapshot,
      })
      .from(revisions)
      .leftJoin(groupMembers, eq(groupMembers.id, revisions.actorMember))
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(revisions.entityType, 'expense'), eq(revisions.entityId, expenseId)))
      .orderBy(revisions.version);
    const detail: ExpenseDetail = {
      expense,
      history: history.map((h) => ({
        version: h.version,
        action: h.action,
        actorName: h.actorName ?? null,
        createdAt: h.createdAt.toISOString(),
        snapshot: h.snapshot as ExpenseSnapshot,
      })),
    };
    return c.json(detail);
  });

  /** Full replacement. `version` must match the stored one (optimistic locking). */
  app.put('/expenses/:expenseId', async (c) => {
    const { groupId, expenseId } = c.req.param() as { groupId: string; expenseId: string };
    const { version, ...input } = await body(c, expenseUpdate);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const before = await loadExpense(tx, groupId, expenseId);
      if (before.deleted) throw new HttpError(409, 'conflict', 'This expense was deleted. Restore it to edit it.', { current: before });

      const existing = new Set([...before.payers.map((p) => p.memberId), ...before.splits.map((s) => s.memberId)]);
      const prepared = await prepareExpense(tx, group, input, existing);
      const updated = await tx
        .update(expenses)
        .set({
          description: input.description,
          category: input.category,
          notes: input.notes,
          expenseDate: input.expenseDate,
          splitMethod: input.split.method,
          amountMinor: prepared.amountMinor,
          originalCurrency: prepared.originalCurrency,
          originalAmountMinor: prepared.originalAmountMinor,
          fxRate: prepared.fxRate,
          updatedAt: new Date(),
          version: sql`${expenses.version} + 1`,
        })
        .where(and(eq(expenses.id, expenseId), eq(expenses.version, version), isNull(expenses.deletedAt)))
        .returning({ id: expenses.id });
      if (updated.length === 0) throw await conflict(tx, groupId, expenseId);

      await writeLines(tx, expenseId, prepared);
      const view = await loadExpense(tx, groupId, expenseId);
      return { view, activityId: await recordChange(tx, group, view, 'update', me.id) };
    });
    notifier.activity(view.activityId);
    return c.json(view.view);
  });

  /** Soft delete; restorable. Body: { version }. */
  app.post('/expenses/:expenseId/delete', async (c) => {
    const { groupId, expenseId } = c.req.param() as { groupId: string; expenseId: string };
    const { version } = await body(c, versionBody);
    const view = await setDeleted(groupId, expenseId, c.var.userId, version, true);
    return c.json(view);
  });

  app.post('/expenses/:expenseId/restore', async (c) => {
    const { groupId, expenseId } = c.req.param() as { groupId: string; expenseId: string };
    const { version } = await body(c, versionBody);
    const view = await setDeleted(groupId, expenseId, c.var.userId, version, false);
    return c.json(view);
  });

  async function setDeleted(groupId: string, expenseId: string, userId: string, version: number, deleted: boolean) {
    return db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      await loadExpense(tx, groupId, expenseId); // 404 if not in this group
      const updated = await tx
        .update(expenses)
        .set({
          deletedAt: deleted ? new Date() : null,
          deletedBy: deleted ? me.id : null,
          updatedAt: new Date(),
          version: sql`${expenses.version} + 1`,
        })
        .where(
          and(
            eq(expenses.id, expenseId),
            eq(expenses.version, version),
            deleted ? isNull(expenses.deletedAt) : sql`${expenses.deletedAt} IS NOT NULL`,
          ),
        )
        .returning({ id: expenses.id });
      if (updated.length === 0) throw await conflict(tx, groupId, expenseId);
      const view = await loadExpense(tx, groupId, expenseId);
      const activityId = await recordChange(tx, group, view, deleted ? 'delete' : 'restore', me.id);
      return { view, activityId };
    }).then(({ view, activityId }) => {
      notifier.activity(activityId);
      return view;
    });
  }

  app.get('/balances', async (c) => {
    const groupId = c.req.param('groupId')!;
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    return c.json(await groupBalances(db, groupId));
  });

  return app;
}
