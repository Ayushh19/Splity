import type { FriendDetail, FriendGroupBalance, FriendSummary } from '@splity/shared';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { groupMembers, groups, users } from '../db/schema';
import { notFound, requireUser, type AppEnv } from '../http';
import { logActivity } from '../services/activity';
import { groupBalances, owedBetween } from '../services/balances';
import { groupDetail } from './groups';

interface Friend {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  upiId: string | null;
  groups: FriendGroupBalance[];
  directGroupId: string | null;
}

/**
 * Everyone with an account who shares a non-archived group with `userId`, and
 * the pairwise balance with each of them per group, in that group's current
 * view (simplified or not) — the same numbers its Balances tab shows.
 */
async function friendsOf(db: DbOrTx, userId: string): Promise<Map<string, Friend>> {
  const mine = await db
    .select({ memberId: groupMembers.id, status: groupMembers.status, group: groups })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), ne(groupMembers.status, 'merged'), isNull(groups.archivedAt)));
  const friends = new Map<string, Friend>();
  if (mine.length === 0) return friends;

  const others = await db
    .select({
      memberId: groupMembers.id,
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      displayName: users.displayName,
      photoUrl: users.photoUrl,
      upiId: users.upiId,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(
      and(
        inArray(groupMembers.groupId, mine.map((m) => m.group.id)),
        isNotNull(groupMembers.userId),
        ne(groupMembers.userId, userId),
        ne(groupMembers.status, 'merged'),
        isNull(users.deletedAt),
      ),
    );

  for (const m of mine) {
    const peers = others.filter((o) => o.groupId === m.group.id);
    if (peers.length === 0) continue;
    const balances = await groupBalances(db, m.group.id);
    for (const p of peers) {
      const friend =
        friends.get(p.userId!) ??
        ({ userId: p.userId!, displayName: p.displayName, photoUrl: p.photoUrl, upiId: p.upiId, groups: [], directGroupId: null } satisfies Friend);
      friends.set(p.userId!, friend);
      if (m.group.isDirect) friend.directGroupId = m.group.id;
      friend.groups.push({
        groupId: m.group.id,
        name: m.group.isDirect ? '1-on-1' : m.group.name,
        isDirect: m.group.isDirect,
        currency: m.group.currency,
        netMinor: owedBetween(balances, p.memberId, m.memberId) - owedBetween(balances, m.memberId, p.memberId),
        theirMemberId: p.memberId,
        yourMemberId: m.memberId,
        writable: m.status === 'active',
      });
    }
  }
  return friends;
}

function totals(groupsWithFriend: FriendGroupBalance[]): FriendSummary['balances'] {
  const byCurrency = new Map<string, number>();
  for (const g of groupsWithFriend) byCurrency.set(g.currency, (byCurrency.get(g.currency) ?? 0) + g.netMinor);
  return [...byCurrency.entries()].filter(([, n]) => n !== 0).map(([currency, netMinor]) => ({ currency, netMinor }));
}

/** Mounted at /friends. */
export function friendRoutes({ db, auth, baseUrl }: { db: Db; auth: Auth; baseUrl: string }) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  /** People with a balance first, then by name. */
  app.get('/', async (c) => {
    const list: FriendSummary[] = [...(await friendsOf(db, c.var.userId)).values()].map((f) => ({
      userId: f.userId,
      displayName: f.displayName,
      photoUrl: f.photoUrl,
      balances: totals(f.groups),
    }));
    list.sort((a, b) => Number(b.balances.length > 0) - Number(a.balances.length > 0) || a.displayName.localeCompare(b.displayName));
    return c.json(list);
  });

  app.get('/:userId', async (c) => {
    const friend = (await friendsOf(db, c.var.userId)).get(c.req.param('userId'));
    if (!friend) throw notFound();
    const detail: FriendDetail = {
      userId: friend.userId,
      displayName: friend.displayName,
      photoUrl: friend.photoUrl,
      upiId: friend.upiId,
      balances: totals(friend.groups),
      // Your 1-on-1 first, then groups with a balance, then the rest.
      groups: [...friend.groups].sort(
        (a, b) => Number(b.isDirect) - Number(a.isDirect) || Number(b.netMinor !== 0) - Number(a.netMinor !== 0) || a.name.localeCompare(b.name),
      ),
      directGroupId: friend.directGroupId,
    };
    return c.json(detail);
  });

  /**
   * Your hidden 1-on-1 group with a friend: returned if it exists, created otherwise
   * (SPEC › 1-on-1 expenses). Currency = your default; both of you are admins.
   */
  app.post('/:userId/direct', async (c) => {
    const me = c.var.userId;
    const friendId = c.req.param('userId');
    const friend = (await friendsOf(db, me)).get(friendId);
    if (!friend) throw notFound();
    const directKey = [me, friendId].sort().join(':');

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(groups).where(eq(groups.directKey, directKey));
      if (existing) return { group: existing, created: false };

      const [creator] = await tx.select().from(users).where(eq(users.id, me));
      const [group] = await tx
        .insert(groups)
        .values({ name: '1-on-1', currency: creator!.defaultCurrency, isDirect: true, directKey, createdBy: me })
        .onConflictDoNothing({ target: groups.directKey })
        .returning();
      if (!group) {
        // Created by the other person a moment ago.
        const [raced] = await tx.select().from(groups).where(eq(groups.directKey, directKey));
        return { group: raced!, created: false };
      }
      const now = new Date();
      const [mine] = await tx
        .insert(groupMembers)
        .values({ groupId: group.id, userId: me, displayName: creator!.displayName, role: 'admin', userSince: now })
        .returning();
      await tx
        .insert(groupMembers)
        .values({ groupId: group.id, userId: friendId, displayName: friend.displayName, role: 'admin', userSince: now });
      await logActivity(tx, { groupId: group.id, actorMember: mine!.id, type: 'group.created', entityType: 'group', entityId: group.id });
      return { group, created: true };
    });

    const [membership] = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, result.group.id), eq(groupMembers.userId, me)));
    return c.json(await groupDetail(db, result.group, membership!, baseUrl), result.created ? 201 : 200);
  });

  return app;
}
