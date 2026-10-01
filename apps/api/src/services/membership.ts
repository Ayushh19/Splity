import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { DbOrTx } from '../db/client';
import { groupMembers, groups, users } from '../db/schema';
import { HttpError, notFound } from '../http';

export type Group = typeof groups.$inferSelect;
export type Member = typeof groupMembers.$inferSelect;

/** 128-bit URL-safe token for invite links. */
export function newInviteToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Load a group and lock its row for the rest of the transaction, so membership
 * changes (joins, the 50-member cap, admin hand-over) are serialized per group.
 */
export async function lockGroup(tx: DbOrTx, groupId: string): Promise<Group> {
  const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('update');
  if (!group) throw notFound();
  return group;
}

export async function getGroup(db: DbOrTx, groupId: string): Promise<Group> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) throw notFound();
  return group;
}

/**
 * The caller's membership in a group. Non-members get 404 (not 403) so group ids
 * don't leak. Removed members can read (they may still need to settle up) but
 * not change anything unless `allowRemoved` is set.
 */
export async function requireMember(
  db: DbOrTx,
  groupId: string,
  userId: string,
  { allowRemoved = false } = {},
): Promise<Member> {
  const [member] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!member || member.status === 'merged') throw notFound();
  if (member.status === 'removed' && !allowRemoved) {
    throw new HttpError(403, 'forbidden', 'You were removed from this group');
  }
  return member;
}

export function requireAdmin(member: Member): void {
  if (member.role !== 'admin') throw new HttpError(403, 'forbidden', 'Only group admins can do that');
}

export function assertWritable(group: Group): void {
  if (group.archivedAt) throw new HttpError(409, 'archived', 'This group is archived');
}

export function assertNotDirect(group: Group): void {
  if (group.isDirect) throw new HttpError(403, 'forbidden', "1-on-1 groups don't have members to manage");
}

export async function getMemberInGroup(db: DbOrTx, groupId: string, memberId: string): Promise<Member> {
  const [member] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.id, memberId)));
  if (!member || member.status === 'merged') throw notFound();
  return member;
}

export async function activeMemberCount(db: DbOrTx, groupId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active')));
  return row?.n ?? 0;
}

/** Shown name: a real user's current profile name, else the placeholder's name. */
export const effectiveName = sql<string>`CASE
  WHEN ${users.deletedAt} IS NOT NULL THEN 'Deleted user'
  WHEN ${users.id} IS NOT NULL AND ${users.displayName} <> '' THEN ${users.displayName}
  ELSE ${groupMembers.displayName} END`;

/** Is `name` already used by an active member (case-insensitive)? */
export async function nameTaken(db: DbOrTx, groupId: string, name: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(groupMembers)
    .leftJoin(users, eq(users.id, groupMembers.userId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, 'active'),
        sql`lower(${effectiveName}) = lower(${name})`,
      ),
    );
  return (row?.n ?? 0) > 0;
}

/**
 * Called before `leaving` stops being an active admin. If no other active admin
 * remains, promote the longest-standing active real member. Returns them, or
 * throws `last_member` if nobody can take over.
 */
export async function handOverAdmin(tx: DbOrTx, groupId: string, leaving: Member): Promise<Member | null> {
  const otherAdmins = await tx
    .select({ n: count() })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, 'active'),
        eq(groupMembers.role, 'admin'),
        ne(groupMembers.id, leaving.id),
      ),
    );
  if ((otherAdmins[0]?.n ?? 0) > 0) return null;

  const [successor] = await tx
    .select()
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.status, 'active'),
        ne(groupMembers.id, leaving.id),
        sql`${groupMembers.userId} IS NOT NULL`,
      ),
    )
    .orderBy(asc(groupMembers.userSince), asc(groupMembers.sortKey))
    .limit(1);
  if (!successor) {
    throw new HttpError(409, 'last_member', 'Someone else needs to join before you can leave');
  }
  await tx.update(groupMembers).set({ role: 'admin' }).where(eq(groupMembers.id, successor.id));
  return successor;
}
