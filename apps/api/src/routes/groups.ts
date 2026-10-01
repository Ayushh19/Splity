import {
  addPlaceholder,
  createGroup,
  MAX_GROUP_MEMBERS,
  updateGroup,
  type GroupDetail,
  type GroupSummary,
  type MemberView,
} from '@splity/shared';
import { and, asc, count, desc, eq, inArray, max } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { activityEvents, groupMembers, groups, users } from '../db/schema';
import { body, forbidden, HttpError, requireUser, type AppEnv } from '../http';
import { logActivity } from '../services/activity';
import { memberLedgers } from '../services/ledger';
import {
  activeMemberCount,
  assertNotDirect,
  assertWritable,
  effectiveName,
  getGroup,
  getMemberInGroup,
  handOverAdmin,
  lockGroup,
  nameTaken,
  newInviteToken,
  requireAdmin,
  requireMember,
  type Group,
  type Member,
} from '../services/membership';

export interface GroupRouteDeps {
  db: Db;
  auth: Auth;
  baseUrl: string;
}

const duplicateName = (name: string) =>
  new HttpError(409, 'duplicate_name', `Someone in this group is already called ${name}`);
const groupFull = () => new HttpError(409, 'group_full', `A group can have at most ${MAX_GROUP_MEMBERS} members`);

export function inviteUrl(baseUrl: string, group: Group): string | null {
  return group.inviteToken ? `${baseUrl}/join/${group.inviteToken}` : null;
}

async function memberName(db: DbOrTx, memberId: string): Promise<string> {
  const [row] = await db
    .select({ name: effectiveName })
    .from(groupMembers)
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.id, memberId));
  return row?.name ?? '';
}

export async function groupDetail(db: DbOrTx, group: Group, me: Member, baseUrl: string): Promise<GroupDetail> {
  const rows = await db
    .select({
      id: groupMembers.id,
      userId: groupMembers.userId,
      claimedAt: groupMembers.claimedAt,
      displayName: effectiveName,
      photoUrl: users.photoUrl,
      role: groupMembers.role,
      status: groupMembers.status,
      sortKey: groupMembers.sortKey,
    })
    .from(groupMembers)
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, group.id), inArray(groupMembers.status, ['active', 'removed'])))
    .orderBy(asc(groupMembers.sortKey));
  const ledgers = await memberLedgers(db, [group.id]);

  const members: MemberView[] = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    photoUrl: r.photoUrl,
    role: r.role,
    status: r.status,
    isPlaceholder: r.userId === null,
    claimed: r.claimedAt !== null,
    isYou: r.id === me.id,
    netMinor: ledgers.get(r.id)?.netMinor ?? 0,
    hasHistory: ledgers.get(r.id)?.hasHistory ?? false,
    sortKey: r.sortKey,
  }));

  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    archived: group.archivedAt !== null,
    inviteUrl: inviteUrl(baseUrl, group),
    you: { memberId: me.id, role: me.role, status: me.status },
    members,
  };
}

export function groupRoutes({ db, auth, baseUrl }: GroupRouteDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  /** Home list: groups I'm in, plus ones I was removed from but still have a balance in. */
  app.get('/', async (c) => {
    const mine = await db
      .select({ group: groups, memberId: groupMembers.id, status: groupMembers.status })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.userId, c.var.userId),
          inArray(groupMembers.status, ['active', 'removed']),
          eq(groups.isDirect, false),
        ),
      );
    const visible = mine.filter((m) => m.group.archivedAt === null);
    const groupIds = visible.map((m) => m.group.id);
    if (groupIds.length === 0) return c.json([] satisfies GroupSummary[]);

    const [ledgers, counts, lastActivity] = await Promise.all([
      memberLedgers(db, groupIds),
      db
        .select({ groupId: groupMembers.groupId, n: count() })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.status, 'active')))
        .groupBy(groupMembers.groupId),
      db
        .select({ groupId: activityEvents.groupId, at: max(activityEvents.createdAt) })
        .from(activityEvents)
        .where(inArray(activityEvents.groupId, groupIds))
        .groupBy(activityEvents.groupId),
    ]);
    const countOf = new Map(counts.map((r) => [r.groupId, r.n]));
    const lastAt = new Map(lastActivity.map((r) => [r.groupId, r.at?.getTime() ?? 0]));

    const summaries: GroupSummary[] = visible
      .map((m) => ({
        id: m.group.id,
        name: m.group.name,
        currency: m.group.currency,
        yourNetMinor: ledgers.get(m.memberId)?.netMinor ?? 0,
        memberCount: countOf.get(m.group.id) ?? 0,
        youAreRemoved: m.status === 'removed',
      }))
      .filter((s) => !s.youAreRemoved || s.yourNetMinor !== 0)
      .sort((a, b) => (lastAt.get(b.id) ?? 0) - (lastAt.get(a.id) ?? 0));
    return c.json(summaries);
  });

  app.post('/', async (c) => {
    const input = await body(c, createGroup);
    const [me] = await db.select().from(users).where(eq(users.id, c.var.userId));
    if (!me) throw new HttpError(401, 'unauthenticated');

    const names = [me.displayName, ...input.placeholders].map((n) => n.toLowerCase());
    const dup = input.placeholders.find((n, i) => names.indexOf(n.toLowerCase()) !== i + 1);
    if (dup) throw duplicateName(dup);

    const detail = await db.transaction(async (tx) => {
      const [group] = await tx
        .insert(groups)
        .values({ name: input.name, currency: input.currency, inviteToken: newInviteToken(), createdBy: me.id })
        .returning();
      const [admin] = await tx
        .insert(groupMembers)
        .values({
          groupId: group!.id,
          userId: me.id,
          displayName: me.displayName,
          role: 'admin',
          userSince: new Date(),
        })
        .returning();
      // One insert per placeholder keeps sort keys in the order they were typed.
      for (const displayName of input.placeholders) {
        await tx.insert(groupMembers).values({ groupId: group!.id, displayName });
      }
      await logActivity(tx, {
        groupId: group!.id,
        actorMember: admin!.id,
        type: 'group.created',
        entityType: 'group',
        entityId: group!.id,
        payload: { name: input.name, currency: input.currency, placeholders: input.placeholders },
      });
      return groupDetail(tx, group!, admin!, baseUrl);
    });
    return c.json(detail, 201);
  });

  app.get('/:groupId', async (c) => {
    const groupId = c.req.param('groupId');
    const me = await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    return c.json(await groupDetail(db, await getGroup(db, groupId), me, baseUrl));
  });

  app.patch('/:groupId', async (c) => {
    const groupId = c.req.param('groupId');
    const input = await body(c, updateGroup);
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      if (input.name !== undefined && input.name !== group.name) {
        assertNotDirect(group);
        await tx.update(groups).set({ name: input.name }).where(eq(groups.id, groupId));
        await logActivity(tx, {
          groupId,
          actorMember: me.id,
          type: 'group.renamed',
          entityType: 'group',
          entityId: groupId,
          payload: { from: group.name, to: input.name },
        });
      }
      if (input.simplifyDebts !== undefined && input.simplifyDebts !== group.simplifyDebts) {
        await tx.update(groups).set({ simplifyDebts: input.simplifyDebts }).where(eq(groups.id, groupId));
        await logActivity(tx, {
          groupId,
          actorMember: me.id,
          type: 'group.simplify_changed',
          entityType: 'group',
          entityId: groupId,
          payload: { simplifyDebts: input.simplifyDebts },
        });
      }
      return groupDetail(tx, await getGroup(tx, groupId), me, baseUrl);
    });
    return c.json(detail);
  });

  /** Add a placeholder member by name. */
  app.post('/:groupId/members', async (c) => {
    const groupId = c.req.param('groupId');
    const { displayName } = await body(c, addPlaceholder);
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      assertNotDirect(group);
      if ((await activeMemberCount(tx, groupId)) >= MAX_GROUP_MEMBERS) throw groupFull();
      if (await nameTaken(tx, groupId, displayName)) throw duplicateName(displayName);
      const [added] = await tx.insert(groupMembers).values({ groupId, displayName }).returning();
      await logActivity(tx, {
        groupId,
        actorMember: me.id,
        type: 'member.added',
        entityType: 'member',
        entityId: added!.id,
        payload: { name: displayName },
      });
      return groupDetail(tx, group, me, baseUrl);
    });
    return c.json(detail, 201);
  });

  app.post('/:groupId/members/:memberId/promote', async (c) => {
    const { groupId, memberId } = c.req.param();
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      requireAdmin(me);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const target = await getMemberInGroup(tx, groupId, memberId);
      if (target.status !== 'active' || target.userId === null) {
        throw forbidden('Only active members with an account can be admins');
      }
      if (target.role !== 'admin') {
        await tx.update(groupMembers).set({ role: 'admin' }).where(eq(groupMembers.id, memberId));
        await logActivity(tx, {
          groupId,
          actorMember: me.id,
          type: 'member.promoted',
          entityType: 'member',
          entityId: memberId,
          payload: { name: await memberName(tx, memberId) },
        });
      }
      return groupDetail(tx, group, me, baseUrl);
    });
    return c.json(detail);
  });

  /** Undo a wrong claim: the row becomes a placeholder again; the user is no longer in the group. */
  app.post('/:groupId/members/:memberId/undo-claim', async (c) => {
    const { groupId, memberId } = c.req.param();
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      requireAdmin(me);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      const target = await getMemberInGroup(tx, groupId, memberId);
      if (target.claimedAt === null) throw forbidden('That member did not claim a placeholder');
      if (target.id === me.id) throw forbidden("You can't undo your own claim");
      if (target.role === 'admin') throw forbidden('Admins must be demoted before their claim can be undone');
      const claimedBy = await memberName(tx, memberId);
      await tx
        .update(groupMembers)
        .set({ userId: null, userSince: null, claimedAt: null })
        .where(eq(groupMembers.id, memberId));
      await logActivity(tx, {
        groupId,
        actorMember: me.id,
        type: 'member.claim_undone',
        entityType: 'member',
        entityId: memberId,
        payload: { placeholder: target.displayName, claimedBy },
      });
      return groupDetail(tx, group, me, baseUrl);
    });
    return c.json(detail);
  });

  /**
   * Admin removes a member. A placeholder that never appeared in an expense or
   * settlement is deleted outright; anyone else is kept as "removed" so history
   * and any outstanding balance stay visible.
   */
  app.delete('/:groupId/members/:memberId', async (c) => {
    const { groupId, memberId } = c.req.param();
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      requireAdmin(me);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      assertNotDirect(group);
      const target = await getMemberInGroup(tx, groupId, memberId);
      if (target.id === me.id) throw forbidden('Use "Leave group" to remove yourself');
      if (target.status !== 'active') throw forbidden('That member was already removed');

      const name = await memberName(tx, memberId);
      const ledger = (await memberLedgers(tx, [groupId])).get(memberId);
      if (target.userId === null && !ledger?.hasHistory) {
        await tx.delete(groupMembers).where(eq(groupMembers.id, memberId));
        await logActivity(tx, { groupId, actorMember: me.id, type: 'member.deleted', payload: { name } });
      } else {
        await tx
          .update(groupMembers)
          .set({ status: 'removed', removedAt: new Date(), role: 'member' })
          .where(eq(groupMembers.id, memberId));
        await logActivity(tx, {
          groupId,
          actorMember: me.id,
          type: 'member.removed',
          entityType: 'member',
          entityId: memberId,
          payload: { name, netMinor: ledger?.netMinor ?? 0 },
        });
      }
      return groupDetail(tx, group, me, baseUrl);
    });
    return c.json(detail);
  });

  /** Leave voluntarily: only with a zero balance; hands admin over if needed. */
  app.post('/:groupId/leave', async (c) => {
    const groupId = c.req.param('groupId');
    await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      if (group.isDirect) throw forbidden("You can't leave a 1-on-1 group");
      const net = (await memberLedgers(tx, [groupId])).get(me.id)?.netMinor ?? 0;
      if (net !== 0) throw new HttpError(409, 'nonzero_balance', 'Settle up before leaving the group');

      const successor = me.role === 'admin' ? await handOverAdmin(tx, groupId, me) : null;
      await tx
        .update(groupMembers)
        .set({ status: 'removed', removedAt: new Date(), role: 'member' })
        .where(eq(groupMembers.id, me.id));
      await logActivity(tx, {
        groupId,
        actorMember: me.id,
        type: 'member.left',
        entityType: 'member',
        entityId: me.id,
        payload: { name: await memberName(tx, me.id) },
      });
      if (successor) {
        await logActivity(tx, {
          groupId,
          actorMember: null,
          type: 'admin.auto_promoted',
          entityType: 'member',
          entityId: successor.id,
          payload: { name: await memberName(tx, successor.id) },
        });
      }
    });
    return c.body(null, 204);
  });

  app.post('/:groupId/invite/reset', async (c) => {
    const groupId = c.req.param('groupId');
    const detail = await db.transaction(async (tx) => {
      const me = await requireMember(tx, groupId, c.var.userId);
      requireAdmin(me);
      const group = await lockGroup(tx, groupId);
      assertWritable(group);
      assertNotDirect(group);
      const [updated] = await tx
        .update(groups)
        .set({ inviteToken: newInviteToken() })
        .where(eq(groups.id, groupId))
        .returning();
      await logActivity(tx, { groupId, actorMember: me.id, type: 'invite.reset', entityType: 'group', entityId: groupId });
      return groupDetail(tx, updated!, me, baseUrl);
    });
    return c.json(detail);
  });

  /** Newest first. Each event carries the display data captured when it happened. */
  app.get('/:groupId/activity', async (c) => {
    const groupId = c.req.param('groupId');
    await requireMember(db, groupId, c.var.userId, { allowRemoved: true });
    const events = await db
      .select({
        id: activityEvents.id,
        type: activityEvents.type,
        actorName: effectiveName,
        payload: activityEvents.payload,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .leftJoin(groupMembers, eq(groupMembers.id, activityEvents.actorMember))
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(activityEvents.groupId, groupId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(100);
    return c.json(events.map((e) => ({ ...e, actorName: e.actorName ?? null })));
  });

  return app;
}
