import { and, eq, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { expensePayers, expenses, expenseSplits, groupMembers, revisions, settlements } from '../db/schema';
import { HttpError } from '../http';
import { loadExpense, snapshotOf } from './expenses';
import type { Group, Member } from './membership';

/**
 * Move everything of `source` (a placeholder) onto `target` (a real member) in
 * one transaction (SPEC › Merge). Totals never change, so the deferred integrity
 * trigger still holds:
 *  - payer/split rows are re-pointed; where both were in the same expense their
 *    amounts are added, and an `equal` split becomes `exact` (two people's
 *    shares in one row aren't an equal split any more);
 *  - payments between the two would become a self-payment, so they're deleted;
 *  - every touched expense/payment gets a version bump and a `merge_repoint` revision.
 */
export async function mergeMembers(tx: DbOrTx, group: Group, source: Member, target: Member, actor: Member) {
  if (source.userId !== null) throw new HttpError(400, 'invalid', 'Only placeholders can be merged into someone');
  if (target.userId === null) throw new HttpError(400, 'invalid', 'Merge into a member who has an account');
  if (source.id === target.id || target.status === 'merged') throw new HttpError(400, 'invalid', 'Pick someone else to merge into');

  // ── Expenses ────────────────────────────────────────────────
  const touched = await tx
    .selectDistinct({ id: expenses.id, splitMethod: expenses.splitMethod })
    .from(expenses)
    .leftJoin(expensePayers, eq(expensePayers.expenseId, expenses.id))
    .leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
    .where(and(eq(expenses.groupId, group.id), or(eq(expensePayers.memberId, source.id), eq(expenseSplits.memberId, source.id))));

  for (const { id: expenseId, splitMethod } of touched) {
    const payers = await tx.select().from(expensePayers).where(eq(expensePayers.expenseId, expenseId));
    const splits = await tx.select().from(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

    const srcPay = payers.find((p) => p.memberId === source.id);
    const tgtPay = payers.find((p) => p.memberId === target.id);
    if (srcPay) {
      await tx.delete(expensePayers).where(and(eq(expensePayers.expenseId, expenseId), eq(expensePayers.memberId, source.id)));
      if (tgtPay) {
        await tx
          .update(expensePayers)
          .set({ paidMinor: tgtPay.paidMinor + srcPay.paidMinor })
          .where(and(eq(expensePayers.expenseId, expenseId), eq(expensePayers.memberId, target.id)));
      } else {
        await tx.insert(expensePayers).values({ expenseId, memberId: target.id, paidMinor: srcPay.paidMinor });
      }
    }

    const srcSplit = splits.find((s) => s.memberId === source.id);
    const tgtSplit = splits.find((s) => s.memberId === target.id);
    let method = splitMethod;
    if (srcSplit) {
      await tx.delete(expenseSplits).where(and(eq(expenseSplits.expenseId, expenseId), eq(expenseSplits.memberId, source.id)));
      if (tgtSplit) {
        const owed = tgtSplit.owedMinor + srcSplit.owedMinor;
        if (splitMethod === 'equal') {
          // Freeze every share as an exact amount so re-opening the expense can't re-split it.
          method = 'exact';
          for (const s of splits) {
            if (s.memberId === source.id) continue;
            await tx
              .update(expenseSplits)
              .set({ exactMinor: s.memberId === target.id ? owed : s.owedMinor })
              .where(and(eq(expenseSplits.expenseId, expenseId), eq(expenseSplits.memberId, s.memberId)));
          }
        }
        await tx
          .update(expenseSplits)
          .set({
            owedMinor: owed,
            shares: tgtSplit.shares !== null && srcSplit.shares !== null ? tgtSplit.shares + srcSplit.shares : tgtSplit.shares,
            ...(splitMethod === 'exact' ? { exactMinor: (tgtSplit.exactMinor ?? 0) + (srcSplit.exactMinor ?? 0) } : {}),
          })
          .where(and(eq(expenseSplits.expenseId, expenseId), eq(expenseSplits.memberId, target.id)));
      } else {
        await tx.insert(expenseSplits).values({ ...srcSplit, memberId: target.id });
      }
    }

    await tx
      .update(expenses)
      .set({ splitMethod: method, version: sql`${expenses.version} + 1`, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId));
    const view = await loadExpense(tx, group.id, expenseId);
    await tx.insert(revisions).values({
      entityType: 'expense',
      entityId: expenseId,
      version: view.version,
      action: 'merge_repoint',
      actorMember: actor.id,
      snapshot: snapshotOf(view),
    });
  }

  // ── Payments ────────────────────────────────────────────────
  const payments = await tx
    .select()
    .from(settlements)
    .where(and(eq(settlements.groupId, group.id), or(eq(settlements.fromMember, source.id), eq(settlements.toMember, source.id))));
  let deletedPayments = 0;
  for (const p of payments) {
    const from = p.fromMember === source.id ? target.id : p.fromMember;
    const to = p.toMember === source.id ? target.id : p.toMember;
    const selfPayment = from === to;
    if (selfPayment && p.deletedAt === null) deletedPayments++;
    const [updated] = await tx
      .update(settlements)
      .set(
        selfPayment
          ? // Keep the original parties on a deleted row (from = to would break the table's check).
            { deletedAt: p.deletedAt ?? new Date(), deletedBy: p.deletedBy ?? actor.id, version: sql`${settlements.version} + 1` }
          : { fromMember: from, toMember: to, version: sql`${settlements.version} + 1` },
      )
      .where(eq(settlements.id, p.id))
      .returning();
    await tx.insert(revisions).values({
      entityType: 'settlement',
      entityId: p.id,
      version: updated!.version,
      action: 'merge_repoint',
      actorMember: actor.id,
      snapshot: {
        fromMember: updated!.fromMember,
        toMember: updated!.toMember,
        amountMinor: updated!.amountMinor,
        settledOn: updated!.settledOn,
        method: updated!.method,
        disputedBy: updated!.disputedBy,
        disputeNote: updated!.disputeNote,
        deleted: updated!.deletedAt !== null,
      },
    });
  }

  // Deleted self-payments keep pointing at the placeholder; its row stays (status
  // 'merged') so foreign keys and history hold.
  await tx
    .update(groupMembers)
    .set({ status: 'merged', mergedInto: target.id, role: 'member', removedAt: null })
    .where(eq(groupMembers.id, source.id));

  return { expenses: touched.length, payments: payments.length, deletedPayments };
}
