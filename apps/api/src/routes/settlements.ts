import {
  canDisputeSettlement,
  canRecordSettlement,
  disputeInput,
  MAX_EXPENSE_MAJOR_UNITS,
  currencyExponent,
  settlementInput,
  settlementUpdate,
  versionBody,
  type SettlementDetail,
  type SettlementSnapshot,
  type SettlementView,
} from '@splity/shared';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { groupMembers, revisions, settlements, users } from '../db/schema';
import { body, forbidden, HttpError, notFound, requireUser, type AppEnv } from '../http';
import { logActivity, type ActivityType } from '../services/activity';
import { assertWritable, effectiveName, lockGroup, requireMember, type Group, type Member } from '../services/membership';
import type { Notifier } from '../services/push';

export interface SettlementRouteDeps {
  db: Db;
  auth: Auth;
  notifier: Notifier;
}

type Row = typeof settlements.$inferSelect;

function toView(row: Row): SettlementView {
  return {
    id: row.id,
    groupId: row.groupId,
    fromMember: row.fromMember,
    toMember: row.toMember,
    amountMinor: row.amountMinor,
    settledOn: row.settledOn,
    method: row.method,
    recordedBy: row.recordedBy,
    disputedBy: row.disputedBy,
    disputedAt: row.disputedAt?.toISOString() ?? null,
    disputeNote: row.disputeNote,
    deleted: row.deletedAt !== null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function snapshotOf(v: SettlementView): SettlementSnapshot {
  return {
    fromMember: v.fromMember,
    toMember: v.toMember,
    amountMinor: v.amountMinor,
    settledOn: v.settledOn,
    method: v.method,
    disputedBy: v.disputedBy,
    disputeNote: v.disputeNote,
    deleted: v.deleted,
  };
}

async function loadSettlement(db: DbOrTx, groupId: string, id: string): Promise<SettlementView> {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), eq(settlements.id, id)));
  if (!row) throw notFound();
  return toView(row);
}

async function membersById(db: DbOrTx, groupId: string, ids: string[]) {
  const rows = await db
    .select({ id: groupMembers.id, userId: groupMembers.userId, status: groupMembers.status, name: effectiveName })
    .from(groupMembers)
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.id, ids)));
  return new Map(rows.map((r) => [r.id, { ...r, isPlaceholder: r.userId === null }]));
}

/** Both parties must be in the group (removed is fine: they may still owe), and the actor allowed. */
async function partiesFor(db: DbOrTx, groupId: string, me: Member, fromId: string, toId: string) {
  const members = await membersById(db, groupId, [fromId, toId]);
  const from = members.get(fromId);
  const to = members.get(toId);
  if (!from || !to || from.status === 'merged' || to.status === 'merged') {
    throw new HttpError(400, 'invalid', 'Both people must be in this group');
  }
  if (!canRecordSettlement(me.id, from, to)) {
    throw forbidden('Only the two people involved can record or change this payment');
  }
  return { from, to };
}

function checkAmountAndDate(group: Group, amountMinor: number, settledOn: string) {
  if (amountMinor > MAX_EXPENSE_MAJOR_UNITS * 10 ** currencyExponent(group.currency)) {
    throw new HttpError(400, 'invalid', 'That amount is too large');
  }
  const latest = new Date(Date.now() + 38 * 3600_000).toISOString().slice(0, 10);
  if (settledOn > latest) throw new HttpError(400, 'invalid', 'The date can be at most one day in the future');
}

async function record(
  tx: DbOrTx,
  group: Group,
  view: SettlementView,
  action: 'create' | 'update' | 'delete' | 'restore' | 'dispute',
  type: ActivityType,
  actor: Member,
): Promise<string> {
  const [revision] = await tx
    .insert(revisions)
    .values({ entityType: 'settlement', entityId: view.id, version: view.version, action, actorMember: actor.id, snapshot: snapshotOf(view) })
    .returning({ id: revisions.id });
  const names = await membersById(tx, group.id, [view.fromMember, view.toMember]);
  return logActivity(tx, {
    groupId: group.id,
    actorMember: actor.id,
    type,
    entityType: 'settlement',
    entityId: view.id,
    revisionId: revision!.id,
    payload: {
      from: names.get(view.fromMember)?.name,
      to: names.get(view.toMember)?.name,
      amountMinor: view.amountMinor,
      currency: group.currency,
      note: view.disputeNote,
    },
  });
}

async function conflict(db: DbOrTx, groupId: string, id: string) {
  return new HttpError(409, 'conflict', 'Someone changed this payment while you were looking at it', {
    current: await loadSettlement(db, groupId, id),
  });
}

/** Mounted at /groups/:groupId. */
export function settlementRoutes({ db, auth, notifier }: SettlementRouteDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  app.get('/settlements', async (c) => {
    const groupId = c.req.param('groupId')!;
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const deleted = c.req.query('deleted') === '1';
    const rows = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), deleted ? isNotNull(settlements.deletedAt) : isNull(settlements.deletedAt)))
      .orderBy(desc(settlements.settledOn), desc(settlements.createdAt));
    return c.json(rows.map(toView));
  });

  /** Record a payment. Removed members may still settle what they owe. */
  app.post('/settlements', async (c) => {
    const groupId = c.req.param('groupId')!;
    const input = await body(c, settlementInput);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId, { allowRemoved: true });
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      await partiesFor(tx, groupId, me, input.fromMember, input.toMember);
      if (me.status === 'removed' && me.id !== input.fromMember && me.id !== input.toMember) {
        throw forbidden('You were removed from this group');
      }
      checkAmountAndDate(group, input.amountMinor, input.settledOn);
      const [row] = await tx
        .insert(settlements)
        .values({ groupId, ...input, recordedBy: me.id })
        .returning();
      const view = toView(row!);
      const activityId = await record(tx, group, view, 'create', 'settlement.recorded', me);
      return { view, activityId };
    });
    notifier.activity(view.activityId);
    return c.json(view.view, 201);
  });

  app.get('/settlements/:settlementId', async (c) => {
    const { groupId, settlementId } = c.req.param() as { groupId: string; settlementId: string };
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const settlement = await loadSettlement(db, groupId, settlementId);
    const history = await db
      .select({ version: revisions.version, action: revisions.action, actorName: effectiveName, createdAt: revisions.createdAt, snapshot: revisions.snapshot })
      .from(revisions)
      .leftJoin(groupMembers, eq(groupMembers.id, revisions.actorMember))
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(revisions.entityType, 'settlement'), eq(revisions.entityId, settlementId)))
      .orderBy(revisions.version);
    const detail: SettlementDetail = {
      settlement,
      history: history.map((h) => ({
        version: h.version,
        action: h.action,
        actorName: h.actorName ?? null,
        createdAt: h.createdAt.toISOString(),
        snapshot: h.snapshot as SettlementSnapshot,
      })),
    };
    return c.json(detail);
  });

  /** Change amount/date/method. Editing resolves a dispute (it is cleared). */
  app.put('/settlements/:settlementId', async (c) => {
    const { groupId, settlementId } = c.req.param() as { groupId: string; settlementId: string };
    const input = await body(c, settlementUpdate);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId, { allowRemoved: true });
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const current = await loadSettlement(tx, groupId, settlementId);
      await partiesFor(tx, groupId, me, current.fromMember, current.toMember);
      checkAmountAndDate(group, input.amountMinor, input.settledOn);
      const updated = await tx
        .update(settlements)
        .set({
          amountMinor: input.amountMinor,
          settledOn: input.settledOn,
          method: input.method,
          disputedAt: null,
          disputedBy: null,
          disputeNote: null,
          updatedAt: new Date(),
          version: sql`${settlements.version} + 1`,
        })
        .where(and(eq(settlements.id, settlementId), eq(settlements.version, input.version), isNull(settlements.deletedAt)))
        .returning();
      if (updated.length === 0) throw await conflict(tx, groupId, settlementId);
      const view = toView(updated[0]!);
      const activityId = await record(tx, group, view, 'update', 'settlement.updated', me);
      return { view, activityId };
    });
    notifier.activity(view.activityId);
    return c.json(view.view);
  });

  for (const [path, deleted] of [['delete', true], ['restore', false]] as const) {
    app.post(`/settlements/:settlementId/${path}`, async (c) => {
      const { groupId, settlementId } = c.req.param() as { groupId: string; settlementId: string };
      const { version } = await body(c, versionBody);
      const view = await db.transaction(async (tx) => {
        const me = await requireMember(tx, groupId, c.var.userId, { allowRemoved: true });
        const group = await lockGroup(tx, groupId);
        assertWritable(group);
        const current = await loadSettlement(tx, groupId, settlementId);
        await partiesFor(tx, groupId, me, current.fromMember, current.toMember);
        const updated = await tx
          .update(settlements)
          .set({
            deletedAt: deleted ? new Date() : null,
            deletedBy: deleted ? me.id : null,
            updatedAt: new Date(),
            version: sql`${settlements.version} + 1`,
          })
          .where(
            and(
              eq(settlements.id, settlementId),
              eq(settlements.version, version),
              deleted ? isNull(settlements.deletedAt) : isNotNull(settlements.deletedAt),
            ),
          )
          .returning();
        if (updated.length === 0) throw await conflict(tx, groupId, settlementId);
        const view = toView(updated[0]!);
        const activityId = await record(tx, group, view, deleted ? 'delete' : 'restore', deleted ? 'settlement.deleted' : 'settlement.restored', me);
        return { view, activityId };
      });
      notifier.activity(view.activityId);
      return c.json(view.view);
    });
  }

  /** The other real party flags it ("I never got this"). It still counts until edited or deleted. */
  app.post('/settlements/:settlementId/dispute', async (c) => {
    const { groupId, settlementId } = c.req.param() as { groupId: string; settlementId: string };
    const { version, note } = await body(c, disputeInput);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId, { allowRemoved: true });
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const current = await loadSettlement(tx, groupId, settlementId);
      if (!canDisputeSettlement(me.id, current)) throw forbidden('Only the other person in this payment can dispute it');
      if (current.deleted) throw new HttpError(409, 'conflict', 'This payment was deleted', { current });
      const updated = await tx
        .update(settlements)
        .set({ disputedAt: new Date(), disputedBy: me.id, disputeNote: note, updatedAt: new Date(), version: sql`${settlements.version} + 1` })
        .where(and(eq(settlements.id, settlementId), eq(settlements.version, version)))
        .returning();
      if (updated.length === 0) throw await conflict(tx, groupId, settlementId);
      const view = toView(updated[0]!);
      const activityId = await record(tx, group, view, 'dispute', 'settlement.disputed', me);
      return { view, activityId };
    });
    notifier.activity(view.activityId);
    return c.json(view.view);
  });

  /** The person who disputed it takes the dispute back. */
  app.post('/settlements/:settlementId/withdraw-dispute', async (c) => {
    const { groupId, settlementId } = c.req.param() as { groupId: string; settlementId: string };
    const { version } = await body(c, versionBody);
    const view = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId, { allowRemoved: true });
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const current = await loadSettlement(tx, groupId, settlementId);
      if (current.disputedBy !== me.id) throw forbidden('Only the person who disputed it can withdraw the dispute');
      const updated = await tx
        .update(settlements)
        .set({ disputedAt: null, disputedBy: null, disputeNote: null, updatedAt: new Date(), version: sql`${settlements.version} + 1` })
        .where(and(eq(settlements.id, settlementId), eq(settlements.version, version)))
        .returning();
      if (updated.length === 0) throw await conflict(tx, groupId, settlementId);
      const view = toView(updated[0]!);
      const activityId = await record(tx, group, view, 'update', 'settlement.dispute_withdrawn', me);
      return { view, activityId };
    });
    notifier.activity(view.activityId);
    return c.json(view.view);
  });

  return app;
}
