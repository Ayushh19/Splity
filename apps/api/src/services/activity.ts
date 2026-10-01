import type { DbOrTx } from '../db/client';
import { activityEvents } from '../db/schema';

export type ActivityType =
  | 'group.created'
  | 'group.renamed'
  | 'group.simplify_changed'
  | 'invite.reset'
  | 'member.added'
  | 'member.joined'
  | 'member.rejoined'
  | 'member.claimed'
  | 'member.claim_undone'
  | 'member.promoted'
  | 'member.removed'
  | 'member.deleted'
  | 'member.left'
  | 'admin.auto_promoted'
  | 'expense.created'
  | 'expense.updated'
  | 'expense.deleted'
  | 'expense.restored'
  | 'settlement.recorded'
  | 'settlement.updated'
  | 'settlement.deleted'
  | 'settlement.restored'
  | 'settlement.disputed'
  | 'settlement.dispute_withdrawn';

export async function logActivity(
  db: DbOrTx,
  event: {
    groupId: string;
    actorMember: string | null;
    type: ActivityType;
    entityType?: 'member' | 'group' | 'expense' | 'settlement';
    entityId?: string;
    revisionId?: string;
    /** Display data captured at the time (names, old/new values). */
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(activityEvents).values({
    groupId: event.groupId,
    actorMember: event.actorMember,
    type: event.type,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    revisionId: event.revisionId ?? null,
    payload: event.payload ?? {},
  });
}
