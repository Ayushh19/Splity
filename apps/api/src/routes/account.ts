import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import * as z from 'zod';
import type { Auth } from '../auth';
import type { Db, DbOrTx } from '../db/client';
import { accounts, groupMembers, groups, pushSubscriptions, sessions, users } from '../db/schema';
import { body, HttpError, requireUser, type AppEnv } from '../http';
import { logActivity } from '../services/activity';
import { memberLedgers } from '../services/ledger';
import { handOverAdmin } from '../services/membership';

const deleteInput = z.object({ confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }) }).strict();

export interface DeletionBlocker {
  groupId: string;
  name: string;
  currency: string;
  isDirect: boolean;
  netMinor: number;
}

/** Groups where the user still owes or is owed money (account deletion waits for these). */
async function blockers(db: DbOrTx, userId: string): Promise<DeletionBlocker[]> {
  const memberships = await db
    .select({ memberId: groupMembers.id, group: groups })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), ne(groupMembers.status, 'merged')));
  const ledgers = await memberLedgers(db, memberships.map((m) => m.group.id));
  return memberships
    .map((m) => ({
      groupId: m.group.id,
      name: m.group.name,
      currency: m.group.currency,
      isDirect: m.group.isDirect,
      netMinor: ledgers.get(m.memberId)?.netMinor ?? 0,
    }))
    .filter((b) => b.netMinor !== 0);
}

/** Mounted at /me. */
export function accountRoutes({ db, auth }: { db: Db; auth: Auth }) {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(auth));

  app.get('/deletion-check', async (c) => {
    const found = await blockers(db, c.var.userId);
    return c.json({ canDelete: found.length === 0, blockers: found });
  });

  /**
   * Delete the account (SPEC › Accounts). Blocked while any balance is non-zero.
   * Personal data goes; membership rows stay so everyone else's history still
   * adds up, shown as "Deleted user". Admin roles pass to the longest-standing member.
   */
  app.post('/delete', async (c) => {
    await body(c, deleteInput);
    const userId = c.var.userId;
    await db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const found = await blockers(tx, userId);
      if (found.length > 0) {
        throw new HttpError(409, 'nonzero_balance', 'Settle up everywhere before deleting your account', { blockers: found });
      }

      const memberships = await tx
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, 'active')));
      for (const m of memberships) {
        // Lock the group like every other membership change.
        await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, m.groupId)).for('update');
        let successor = null;
        if (m.role === 'admin') {
          try {
            successor = await handOverAdmin(tx, m.groupId, m);
          } catch (e) {
            // Nobody with an account is left to take over; the group simply has no admin.
            if (!(e instanceof HttpError && e.code === 'last_member')) throw e;
          }
        }
        await tx
          .update(groupMembers)
          .set({ status: 'removed', removedAt: new Date(), role: 'member', muted: true })
          .where(eq(groupMembers.id, m.id));
        await logActivity(tx, { groupId: m.groupId, actorMember: m.id, type: 'member.account_deleted', entityType: 'member', entityId: m.id });
        if (successor) {
          const [heir] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, successor.userId!));
          await logActivity(tx, {
            groupId: m.groupId,
            actorMember: null,
            type: 'admin.auto_promoted',
            entityType: 'member',
            entityId: successor.id,
            payload: { name: heir?.name ?? successor.displayName },
          });
        }
      }

      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      await tx.delete(accounts).where(eq(accounts.userId, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx
        .update(users)
        .set({
          // Email must stay unique and non-null; this address can never receive mail (.invalid TLD).
          email: `deleted-${userId}@deleted.invalid`,
          emailVerified: false,
          displayName: 'Deleted user',
          photoUrl: null,
          upiId: null,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    });
    return c.body(null, 204);
  });

  return app;
}
