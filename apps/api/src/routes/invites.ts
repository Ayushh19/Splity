import { joinInvite, MAX_GROUP_MEMBERS, type InvitePreview } from '@splity/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { groupMembers, groups, users } from '../db/schema';
import { body, HttpError, notFound, requireUser, type AppEnv } from '../http';
import { logActivity } from '../services/activity';
import { activeMemberCount, lockGroup, type Group } from '../services/membership';
import { groupDetail } from './groups';

export interface InviteRouteDeps {
  db: Db;
  auth: Auth;
  baseUrl: string;
}

/** A live invite: unknown, reset, direct and archived groups all look the same (404). */
async function groupForToken(db: DbOrTx, token: string): Promise<Group> {
  const [group] = await db.select().from(groups).where(eq(groups.inviteToken, token));
  if (!group || group.isDirect || group.archivedAt) throw notFound();
  return group;
}

export function inviteRoutes({ db, auth, baseUrl }: InviteRouteDeps) {
  const app = new Hono<AppEnv>();

  /**
   * Preview for the invite landing page. Works signed out (the token is the
   * secret), so people can see which placeholder is theirs before signing in.
   */
  app.get('/:token', async (c) => {
    const group = await groupForToken(db, c.req.param('token'));
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    const [unclaimed, count, mine] = await Promise.all([
      db
        .select({ id: groupMembers.id, displayName: groupMembers.displayName })
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'active'), isNull(groupMembers.userId)),
        )
        .orderBy(asc(groupMembers.sortKey)),
      activeMemberCount(db, group.id),
      session
        ? db
            .select({ status: groupMembers.status })
            .from(groupMembers)
            .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, session.user.id)))
        : Promise.resolve([]),
    ]);

    const preview: InvitePreview = {
      groupId: group.id,
      groupName: group.name,
      memberCount: count,
      unclaimed,
      alreadyMember: mine[0]?.status === 'active',
    };
    return c.json(preview);
  });

  /** Join: claim a placeholder, join as a new member, or rejoin after being removed. */
  app.post('/:token/join', requireUser(auth), async (c) => {
    const { claimMemberId } = await body(c, joinInvite);
    const detail = await db.transaction(async (tx) => {
      const { id: groupId } = await groupForToken(tx, c.req.param('token'));
      const group = await lockGroup(tx, groupId);
      const [user] = await tx.select().from(users).where(eq(users.id, c.var.userId));
      if (!user) throw new HttpError(401, 'unauthenticated');

      const [existing] = await tx
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)));
      if (existing?.status === 'active') {
        throw new HttpError(409, 'already_member', "You're already in this group");
      }

      const now = new Date();

      if (claimMemberId) {
        if (existing) {
          throw new HttpError(409, 'already_member', 'You were in this group before, so rejoin instead of claiming');
        }
        const [placeholder] = await tx
          .select()
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, claimMemberId)));
        if (!placeholder || placeholder.status !== 'active') throw notFound();
        if (placeholder.userId !== null) {
          throw new HttpError(409, 'already_claimed', `${placeholder.displayName} has already been claimed`);
        }
        const [claimed] = await tx
          .update(groupMembers)
          .set({ userId: user.id, userSince: now, claimedAt: now })
          .where(and(eq(groupMembers.id, placeholder.id), isNull(groupMembers.userId)))
          .returning();
        if (!claimed) throw new HttpError(409, 'already_claimed', `${placeholder.displayName} has already been claimed`);
        await logActivity(tx, {
          groupId,
          actorMember: claimed.id,
          type: 'member.claimed',
          entityType: 'member',
          entityId: claimed.id,
          payload: { name: user.displayName, placeholder: placeholder.displayName },
        });
        return groupDetail(tx, group, claimed, baseUrl);
      }

      if ((await activeMemberCount(tx, groupId)) >= MAX_GROUP_MEMBERS) {
        throw new HttpError(409, 'group_full', `A group can have at most ${MAX_GROUP_MEMBERS} members`);
      }

      if (existing) {
        // Was removed (or left) earlier: reactivate the same row so their history stays theirs.
        const [rejoined] = await tx
          .update(groupMembers)
          .set({ status: 'active', removedAt: null })
          .where(eq(groupMembers.id, existing.id))
          .returning();
        await logActivity(tx, {
          groupId,
          actorMember: rejoined!.id,
          type: 'member.rejoined',
          entityType: 'member',
          entityId: rejoined!.id,
          payload: { name: user.displayName },
        });
        return groupDetail(tx, group, rejoined!, baseUrl);
      }

      const [joined] = await tx
        .insert(groupMembers)
        .values({ groupId, userId: user.id, displayName: user.displayName, userSince: now })
        .returning();
      await logActivity(tx, {
        groupId,
        actorMember: joined!.id,
        type: 'member.joined',
        entityType: 'member',
        entityId: joined!.id,
        payload: { name: user.displayName },
      });
      return groupDetail(tx, group, joined!, baseUrl);
    });
    return c.json(detail, 201);
  });

  return app;
}
