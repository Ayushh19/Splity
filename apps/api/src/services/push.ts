import { formatAmount, type ExpenseSnapshot, type PushPayload, type SettlementSnapshot } from '@splity/shared';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import webpush from 'web-push';
import type { Db } from '../db/client';
import { activityEvents, groupMembers, groups, pushSubscriptions, revisions, users } from '../db/schema';
import { effectiveName } from './membership';

export interface DeviceSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Delivers one payload to one device. 'gone' means the browser dropped the subscription. */
export type PushSender = (subscription: DeviceSubscription, payload: PushPayload) => Promise<'ok' | 'gone'>;

export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24, urgency: 'normal' },
      );
      return 'ok';
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw e;
    }
  };
}

const EXPENSE_VERBS: Record<string, string> = {
  'expense.created': 'added',
  'expense.updated': 'edited',
  'expense.deleted': 'deleted',
  'expense.restored': 'restored',
};
const SETTLEMENT_VERBS: Record<string, string> = {
  'settlement.recorded': 'recorded a payment',
  'settlement.updated': 'edited a payment',
  'settlement.deleted': 'deleted a payment',
  'settlement.restored': 'restored a payment',
  'settlement.disputed': 'disputed a payment',
  'settlement.dispute_withdrawn': 'withdrew a dispute',
};

/**
 * Turns activity into push notifications (SPEC › Activity & Notifications):
 * expense changes go to the people in that expense, payment changes to the two
 * parties — never to the person who made the change, never to muted members or
 * placeholders. Member and group events stay in the feed only.
 *
 * Sends run after the request's transaction has committed and never fail it.
 * `idle()` resolves when everything queued so far has been sent (for tests).
 */
export function createNotifier(db: Db, send: PushSender | null) {
  const pending = new Set<Promise<unknown>>();

  function track(work: Promise<unknown>) {
    const p = work.catch((e) => console.error('[push]', e)).finally(() => pending.delete(p));
    pending.add(p);
  }

  async function deliver(userIds: string[], payload: (userId: string) => PushPayload | null): Promise<number> {
    if (!send || userIds.length === 0) return 0;
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        const p = payload(sub.userId);
        if (!p) return;
        if ((await send(sub, p)) === 'gone') {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          sent++;
        }
      }),
    );
    return sent;
  }

  async function forActivity(activityId: string) {
    const [event] = await db
      .select({
        type: activityEvents.type,
        groupId: activityEvents.groupId,
        entityId: activityEvents.entityId,
        actorMember: activityEvents.actorMember,
        revisionId: activityEvents.revisionId,
        payload: activityEvents.payload,
        groupName: groups.name,
        currency: groups.currency,
      })
      .from(activityEvents)
      .innerJoin(groups, eq(groups.id, activityEvents.groupId))
      .where(eq(activityEvents.id, activityId));
    if (!event || !event.revisionId || !event.entityId) return;
    const isExpense = event.type in EXPENSE_VERBS;
    if (!isExpense && !(event.type in SETTLEMENT_VERBS)) return;

    const [revision] = await db.select().from(revisions).where(eq(revisions.id, event.revisionId));
    if (!revision) return;
    const [previous] = await db
      .select({ snapshot: revisions.snapshot })
      .from(revisions)
      .where(and(eq(revisions.entityType, revision.entityType), eq(revisions.entityId, revision.entityId), eq(revisions.version, revision.version - 1)));

    // Everyone involved before or after the change (someone taken off an expense should hear about it).
    const involved = new Set<string>();
    for (const snap of [revision.snapshot, previous?.snapshot]) {
      if (!snap) continue;
      if (isExpense) {
        const s = snap as ExpenseSnapshot;
        s.payers.forEach((p) => involved.add(p.memberId));
        s.splits.forEach((x) => involved.add(x.memberId));
      } else {
        const s = snap as SettlementSnapshot;
        involved.add(s.fromMember);
        involved.add(s.toMember);
      }
    }

    const people = await db
      .select({ memberId: groupMembers.id, userId: groupMembers.userId, name: effectiveName })
      .from(groupMembers)
      .leftJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, event.groupId), inArray(groupMembers.id, [...involved, ...(event.actorMember ? [event.actorMember] : [])])));
    const nameOf = new Map(people.map((p) => [p.memberId, p.name]));
    const actorName = (event.actorMember && nameOf.get(event.actorMember)) || 'Someone';

    const recipients = await db
      .select({ memberId: groupMembers.id, userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          inArray(groupMembers.id, [...involved]),
          isNotNull(groupMembers.userId),
          ne(groupMembers.status, 'merged'),
          eq(groupMembers.muted, false),
          ...(event.actorMember ? [ne(groupMembers.id, event.actorMember)] : []),
        ),
      );
    const memberOfUser = new Map(recipients.map((r) => [r.userId!, r.memberId]));
    const money = (minor: number) => formatAmount(minor, event.currency);

    await deliver([...memberOfUser.keys()], (userId) => {
      const me = memberOfUser.get(userId)!;
      if (isExpense) {
        const s = revision.snapshot as ExpenseSnapshot;
        const paid = s.payers.find((p) => p.memberId === me)?.paidMinor ?? 0;
        const owed = s.splits.find((x) => x.memberId === me)?.owedMinor ?? 0;
        const net = paid - owed;
        const share =
          event.type === 'expense.deleted'
            ? ' It no longer counts.'
            : net < 0
              ? ` You owe ${money(-net)}.`
              : net > 0
                ? ` You lent ${money(net)}.`
                : !s.payers.some((p) => p.memberId === me) && !s.splits.some((x) => x.memberId === me)
                  ? ` You're no longer in it.`
                  : '';
        return {
          title: event.groupName,
          body: `${actorName} ${EXPENSE_VERBS[event.type]} "${s.description}" (${money(s.amountMinor)}).${share}`,
          url: `/groups/${event.groupId}/expenses/${event.entityId}`,
          tag: `expense-${event.entityId}`,
        };
      }
      const s = revision.snapshot as SettlementSnapshot;
      const who = (id: string) => (id === me ? 'you' : (nameOf.get(id) ?? 'someone'));
      const note = event.type === 'settlement.disputed' && s.disputeNote ? ` — "${s.disputeNote}"` : '';
      return {
        title: event.groupName,
        body: `${actorName} ${SETTLEMENT_VERBS[event.type]}: ${who(s.fromMember)} paid ${who(s.toMember)} ${money(s.amountMinor)}${note}`,
        url: `/groups/${event.groupId}/settlements/${event.entityId}`,
        tag: `settlement-${event.entityId}`,
      };
    });
  }

  return {
    enabled: send !== null,
    /** Queue notifications for an activity event (call after the transaction commits). */
    activity(activityId: string | null | undefined) {
      if (activityId && send) track(forActivity(activityId));
    },
    /** Send a reminder now; resolves to the number of devices it reached. */
    async remind(toUserId: string, payload: PushPayload): Promise<number> {
      return deliver([toUserId], () => payload);
    },
    /** How many devices a user has notifications on. */
    async deviceCount(userId: string): Promise<number> {
      if (!send) return 0;
      const subs = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
      return subs.length;
    },
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
