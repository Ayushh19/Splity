import { netBalances, rawDebts, simplifyDebts, type GroupBalances, type LedgerSettlement } from '@splity/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { settlements } from '../db/schema';
import { groupOrder, loadExpenses } from './expenses';
import { getGroup } from './membership';

/** Net, raw and simplified balances, computed with @splity/shared from the stored rows. */
export async function groupBalances(db: DbOrTx, groupId: string): Promise<GroupBalances> {
  const group = await getGroup(db, groupId);
  const [ledger, settled, { members, order }] = await Promise.all([
    loadExpenses(db, groupId, { deleted: false }),
    db
      .select({ from: settlements.fromMember, to: settlements.toMember, amountMinor: settlements.amountMinor })
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt))),
    groupOrder(db, groupId),
  ]);
  const payments: LedgerSettlement[] = settled;
  const net = netBalances(ledger, payments);
  return {
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    net: [...members.values()]
      .filter((m) => m.status !== 'merged')
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((m) => ({ memberId: m.id, netMinor: net.get(m.id) ?? 0 })),
    raw: rawDebts(ledger, payments, order),
    simplified: simplifyDebts(net, order),
  };
}

/** What `debtor` owes `creditor` in the group's current view (simplified or raw). */
export function owedBetween(b: GroupBalances, debtor: string, creditor: string): number {
  const transfers = b.simplifyDebts ? b.simplified : b.raw;
  return transfers.find((t) => t.from === debtor && t.to === creditor)?.amountMinor ?? 0;
}
