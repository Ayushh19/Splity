import {
  anchorFor,
  expenseInput,
  nextOccurrence,
  occurrenceOnOrAfter,
  type ExpenseView,
  type Frequency,
  type PausedReason,
  type RecurringSeriesView,
} from '@splity/shared';
import { and, count, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import { expenses, groupMembers, groups, recurringSeries, users } from '../db/schema';
import { HttpError } from '../http';
import { logActivity } from './activity';
import { loadExpense, prepareExpense, recordChange, writeLines } from './expenses';
import type { Group } from './membership';
import type { Notifier } from './push';

type Series = typeof recurringSeries.$inferSelect;

/**
 * Create a series whose first occurrence is the expense being added. Missed dates
 * are never back-filled: an old first date starts the schedule from today.
 */
export async function createSeries(tx: DbOrTx, groupId: string, frequency: Frequency, firstDate: string, today: string, createdBy: string) {
  const anchorDay = anchorFor(frequency, firstDate);
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const nextDue = nextOccurrence(frequency, anchorDay, firstDate > yesterday ? firstDate : yesterday);
  const [series] = await tx.insert(recurringSeries).values({ groupId, frequency, anchorDay, nextDue, createdBy }).returning();
  return series!;
}

/** The most recent non-deleted occurrence: the template for the next one. */
async function latestOccurrence(db: DbOrTx, series: Series): Promise<ExpenseView | null> {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.recurringSeriesId, series.id), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.occurrenceDate), desc(expenses.createdAt))
    .limit(1);
  return row ? loadExpense(db, series.groupId, row.id) : null;
}

type Template = { ok: true; input: ReturnType<typeof expenseInput.parse> } | { ok: false; reason: PausedReason };

/**
 * Turn the latest occurrence into the next one's input (SPEC › Recurring):
 * removed people are skipped in equal/shares splits; a removed payer or a
 * removed person in an exact split pauses the series instead of guessing.
 */
async function templateFrom(db: DbOrTx, latest: ExpenseView, date: string): Promise<Template> {
  const members = await db
    .select({ id: groupMembers.id, status: groupMembers.status, mergedInto: groupMembers.mergedInto })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, latest.groupId));
  const byId = new Map(members.map((m) => [m.id, m]));
  // Merges already re-point stored rows; follow mergedInto anyway in case of an old template.
  const resolve = (id: string) => {
    let m = byId.get(id);
    for (let hops = 0; m?.status === 'merged' && m.mergedInto && hops < 10; hops++) m = byId.get(m.mergedInto);
    return m;
  };
  const active = (id: string) => resolve(id)?.status === 'active';

  const payers = latest.payers.map((p) => ({ memberId: resolve(p.memberId)?.id ?? p.memberId, paidMinor: p.paidMinor }));
  if (payers.some((p) => !active(p.memberId))) return { ok: false, reason: 'removed_payer' };

  let split: ReturnType<typeof expenseInput.parse>['split'];
  if (latest.splitMethod === 'exact') {
    if (latest.splits.some((s) => !active(s.memberId))) return { ok: false, reason: 'removed_participant' };
    split = { method: 'exact', amounts: latest.splits.map((s) => ({ memberId: resolve(s.memberId)!.id, amountMinor: s.exactMinor ?? s.owedMinor })) };
  } else if (latest.splitMethod === 'shares') {
    const shares = new Map<string, number>();
    for (const s of latest.splits) {
      if (!active(s.memberId)) continue;
      const id = resolve(s.memberId)!.id;
      shares.set(id, (shares.get(id) ?? 0) + (s.shares ?? 1));
    }
    if (shares.size === 0) return { ok: false, reason: 'removed_participant' };
    split = { method: 'shares', shares: [...shares].map(([memberId, n]) => ({ memberId, shares: n })) };
  } else {
    const participants = [...new Set(latest.splits.filter((s) => active(s.memberId)).map((s) => resolve(s.memberId)!.id))];
    if (participants.length === 0) return { ok: false, reason: 'removed_participant' };
    split = { method: 'equal', participants };
  }

  return {
    ok: true,
    input: expenseInput.parse({
      description: latest.description,
      category: latest.category,
      notes: latest.notes,
      expenseDate: date,
      amountMinor: latest.amountMinor,
      foreign:
        latest.originalCurrency && latest.originalAmountMinor !== null && latest.fxRate
          ? { currency: latest.originalCurrency, amountMinor: latest.originalAmountMinor, rate: latest.fxRate }
          : null,
      payers,
      split,
    }),
  };
}

const REASON_TEXT: Record<PausedReason, string> = {
  manual: 'it was paused',
  removed_participant: 'someone in its exact split was removed from the group',
  removed_payer: 'the person who pays it was removed from the group',
};

export function createRecurringJob(db: Db, notifier: Notifier) {
  /** Pause a series and tell its creator why (pushed even if they muted the group). */
  async function pause(tx: DbOrTx, group: Group, series: Series, reason: PausedReason, description: string) {
    await tx.update(recurringSeries).set({ status: 'paused', pausedReason: reason }).where(eq(recurringSeries.id, series.id));
    await logActivity(tx, {
      groupId: group.id,
      actorMember: null,
      type: 'recurring.paused',
      entityType: 'group',
      entityId: group.id,
      payload: { description, reason },
    });
    return { userId: await creatorUserId(tx, series), description, reason };
  }

  async function creatorUserId(tx: DbOrTx, series: Series) {
    const [row] = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.id, series.createdBy), isNull(users.deletedAt)));
    return row?.userId ?? null;
  }

  /**
   * Create every occurrence due on or before `today` for active series in
   * non-archived groups. Idempotent: (series, date) is unique, so overlapping
   * or repeated runs can't double-create.
   */
  async function runDue(today: string, onlyGroupId?: string) {
    const due = await db
      .select({ series: recurringSeries })
      .from(recurringSeries)
      .innerJoin(groups, eq(groups.id, recurringSeries.groupId))
      .where(
        and(
          eq(recurringSeries.status, 'active'),
          lte(recurringSeries.nextDue, today),
          isNull(groups.archivedAt),
          onlyGroupId ? eq(recurringSeries.groupId, onlyGroupId) : undefined,
        ),
      );

    let created = 0;
    let paused = 0;
    for (const { series: candidate } of due) {
      const result = await db.transaction(async (tx) => {
        const [group] = await tx.select().from(groups).where(eq(groups.id, candidate.groupId)).for('update');
        const [series] = await tx.select().from(recurringSeries).where(eq(recurringSeries.id, candidate.id));
        const activityIds: string[] = [];
        if (!group || !series || series.status !== 'active' || group.archivedAt) {
          return { activityIds, pausedFor: null, made: 0, groupName: group?.name ?? 'Splity' };
        }

        let nextDue = series.nextDue;
        let made = 0;
        let pausedFor: Awaited<ReturnType<typeof pause>> | null = null;
        while (nextDue <= today) {
          const latest = await latestOccurrence(tx, series);
          if (!latest) {
            // Every occurrence was deleted: nothing to copy, so the series ends.
            await tx.update(recurringSeries).set({ status: 'stopped' }).where(eq(recurringSeries.id, series.id));
            break;
          }
          const template = await templateFrom(tx, latest, nextDue);
          if (!template.ok) {
            pausedFor = await pause(tx, group, series, template.reason, latest.description);
            break;
          }
          const prepared = await prepareExpense(tx, group, template.input, new Set(), { trustedDate: true });
          const [row] = await tx
            .insert(expenses)
            .values({
              groupId: group.id,
              createdBy: null,
              description: template.input.description,
              category: template.input.category,
              notes: template.input.notes,
              expenseDate: nextDue,
              splitMethod: template.input.split.method,
              amountMinor: prepared.amountMinor,
              originalCurrency: prepared.originalCurrency,
              originalAmountMinor: prepared.originalAmountMinor,
              fxRate: prepared.fxRate,
              recurringSeriesId: series.id,
              occurrenceDate: nextDue,
            })
            .onConflictDoNothing({ target: [expenses.recurringSeriesId, expenses.occurrenceDate] })
            .returning({ id: expenses.id });
          if (row) {
            await writeLines(tx, row.id, prepared);
            activityIds.push(await recordChange(tx, group, await loadExpense(tx, group.id, row.id), 'create', null));
            made++;
          }
          nextDue = nextOccurrence(series.frequency, series.anchorDay, nextDue);
        }
        await tx.update(recurringSeries).set({ nextDue }).where(eq(recurringSeries.id, series.id));
        return { activityIds, pausedFor, made, groupName: group.name };
      });

      created += result.made;
      for (const id of result.activityIds) notifier.activity(id);
      if (result.pausedFor) {
        paused++;
        const { userId, description, reason } = result.pausedFor;
        if (userId) {
          void notifier
            .remind(userId, {
              title: result.groupName,
              body: `"${description}" stopped repeating because ${REASON_TEXT[reason]}. Fix the latest one and resume it.`,
              url: `/groups/${candidate.groupId}/recurring`,
              tag: `recurring-${candidate.id}`,
            })
            .catch((e) => console.error('[recurring] notify', e));
        }
      }
    }
    return { created, paused };
  }

  return { runDue, pause };
}

export type RecurringJob = ReturnType<typeof createRecurringJob>;

export async function seriesViews(db: DbOrTx, groupId: string, ids?: string[]): Promise<RecurringSeriesView[]> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.groupId, groupId), ids ? inArray(recurringSeries.id, ids) : undefined))
    .orderBy(recurringSeries.status, recurringSeries.nextDue);
  if (rows.length === 0) return [];
  const counts = await db
    .select({ id: expenses.recurringSeriesId, n: count() })
    .from(expenses)
    .where(and(inArray(expenses.recurringSeriesId, rows.map((r) => r.id)), isNull(expenses.deletedAt)))
    .groupBy(expenses.recurringSeriesId);
  const countOf = new Map(counts.map((c) => [c.id, c.n]));

  const views: RecurringSeriesView[] = [];
  for (const s of rows) {
    const latest = await latestOccurrence(db, s);
    views.push({
      id: s.id,
      groupId: s.groupId,
      frequency: s.frequency,
      anchorDay: s.anchorDay,
      nextDue: s.nextDue,
      status: s.status,
      pausedReason: s.pausedReason,
      createdBy: s.createdBy,
      occurrences: countOf.get(s.id) ?? 0,
      latest: latest
        ? { expenseId: latest.id, description: latest.description, amountMinor: latest.amountMinor, occurrenceDate: latest.expenseDate }
        : null,
    });
  }
  return views;
}

/** Resume: the latest occurrence must be valid now; missed dates are skipped. */
export async function resumeSeries(tx: DbOrTx, group: Group, series: Series, today: string) {
  const latest = await latestOccurrence(tx, series);
  if (!latest) throw new HttpError(409, 'conflict', 'Every occurrence was deleted; add a new repeating expense instead');
  const template = await templateFrom(tx, latest, today);
  if (!template.ok) {
    throw new HttpError(409, 'conflict', `Can't resume yet: ${REASON_TEXT[template.reason]}. Edit "${latest.description}" first.`, {
      expenseId: latest.id,
    });
  }
  const nextDue = occurrenceOnOrAfter(series.frequency, series.anchorDay, today);
  await tx.update(recurringSeries).set({ status: 'active', pausedReason: null, nextDue }).where(eq(recurringSeries.id, series.id));
  return nextDue;
}

/** Archiving a group pauses its series so nothing new lands in a read-only group. */
export async function pauseAllInGroup(tx: DbOrTx, groupId: string) {
  await tx
    .update(recurringSeries)
    .set({ status: 'paused', pausedReason: 'manual' })
    .where(and(eq(recurringSeries.groupId, groupId), eq(recurringSeries.status, 'active')));
}
