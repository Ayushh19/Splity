import { MoneyError, type MemberId, type Minor } from './money';
import { compareMembers, sortByMember, type MemberOrder } from './order';
import type { Owed, Payer } from './split';

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amountMinor: Minor;
}

export interface LedgerExpense {
  payers: readonly Payer[];
  splits: readonly Owed[];
}

export interface LedgerSettlement {
  from: MemberId;
  to: MemberId;
  amountMinor: Minor;
}

function add(map: Map<MemberId, Minor>, id: MemberId, delta: Minor): void {
  map.set(id, (map.get(id) ?? 0) + delta);
}

/**
 * Net position per member: positive = owed money, negative = owes money.
 * Callers pass only non-deleted expenses and settlements. Always sums to zero.
 */
export function netBalances(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): Map<MemberId, Minor> {
  const net = new Map<MemberId, Minor>();
  for (const e of expenses) {
    for (const p of e.payers) add(net, p.memberId, p.paidMinor);
    for (const s of e.splits) add(net, s.memberId, -s.owedMinor);
  }
  for (const s of settlements) {
    add(net, s.from, s.amountMinor);
    add(net, s.to, -s.amountMinor);
  }
  return net;
}

/**
 * Who owes whom inside a single expense, using the fewest transfers: people who
 * paid less than their share pay people who paid more, both lists walked in
 * member order. A payer who paid exactly their own share is not involved.
 */
export function expenseTransfers(expense: LedgerExpense, order: MemberOrder): Transfer[] {
  const delta = netBalances([expense], []);
  return matchInOrder(delta, order);
}

function matchInOrder(delta: ReadonlyMap<MemberId, Minor>, order: MemberOrder): Transfer[] {
  const entries = [...delta.entries()];
  if (entries.reduce((sum, [, d]) => sum + d, 0) !== 0) {
    throw new MoneyError('SUM_MISMATCH', 'Amounts paid and owed do not balance');
  }
  const debtors = sortByMember(
    order,
    entries.filter(([, d]) => d < 0).map(([id, d]) => ({ id, left: -d })),
    (x) => x.id,
  );
  const creditors = sortByMember(
    order,
    entries.filter(([, d]) => d > 0).map(([id, d]) => ({ id, left: d })),
    (x) => x.id,
  );

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]!;
    const creditor = creditors[j]!;
    const amount = Math.min(debtor.left, creditor.left);
    transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
    debtor.left -= amount;
    creditor.left -= amount;
    if (debtor.left === 0) i++;
    if (creditor.left === 0) j++;
  }
  return transfers;
}

/**
 * The unsimplified "who owes whom" for a group: per-expense transfers plus
 * settlements, netted per pair of members. A settlement from A to B reduces
 * what A owes B (or makes B owe A if it overshoots).
 */
export function rawDebts(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
  order: MemberOrder,
): Transfer[] {
  // owes.get(a)?.get(b) = how much a owes b, before netting the pair.
  const owes = new Map<MemberId, Map<MemberId, Minor>>();
  const addDebt = (from: MemberId, to: MemberId, amount: Minor) => {
    let row = owes.get(from);
    if (!row) owes.set(from, (row = new Map()));
    row.set(to, (row.get(to) ?? 0) + amount);
  };

  for (const e of expenses) {
    for (const t of expenseTransfers(e, order)) addDebt(t.from, t.to, t.amountMinor);
  }
  for (const s of settlements) addDebt(s.to, s.from, s.amountMinor);

  const result: Transfer[] = [];
  const seen = new Set<string>();
  for (const [a, row] of owes) {
    for (const b of row.keys()) {
      const key = compareMembers(order, a, b) < 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const net = (owes.get(a)?.get(b) ?? 0) - (owes.get(b)?.get(a) ?? 0);
      if (net > 0) result.push({ from: a, to: b, amountMinor: net });
      else if (net < 0) result.push({ from: b, to: a, amountMinor: -net });
    }
  }
  return sortTransfers(result, order);
}

/**
 * Simplified debts: repeatedly match the member who owes the most with the
 * member who is owed the most (ties broken by member order). Produces at most
 * n−1 transfers and is deterministic; not guaranteed to be the absolute minimum.
 */
export function simplifyDebts(net: ReadonlyMap<MemberId, Minor>, order: MemberOrder): Transfer[] {
  const entries = [...net.entries()];
  if (entries.reduce((sum, [, d]) => sum + d, 0) !== 0) {
    throw new MoneyError('SUM_MISMATCH', 'Net balances do not add up to zero');
  }
  const debtors = entries.filter(([, d]) => d < 0).map(([id, d]) => ({ id, left: -d }));
  const creditors = entries.filter(([, d]) => d > 0).map(([id, d]) => ({ id, left: d }));

  const largest = (list: { id: MemberId; left: Minor }[]) => {
    let best: { id: MemberId; left: Minor } | undefined;
    for (const x of list) {
      if (x.left === 0) continue;
      if (!best || x.left > best.left || (x.left === best.left && compareMembers(order, x.id, best.id) < 0)) {
        best = x;
      }
    }
    return best;
  };

  const transfers: Transfer[] = [];
  for (;;) {
    const debtor = largest(debtors);
    const creditor = largest(creditors);
    if (!debtor || !creditor) break;
    const amount = Math.min(debtor.left, creditor.left);
    transfers.push({ from: debtor.id, to: creditor.id, amountMinor: amount });
    debtor.left -= amount;
    creditor.left -= amount;
  }
  return sortTransfers(transfers, order);
}

function sortTransfers(transfers: Transfer[], order: MemberOrder): Transfer[] {
  return transfers.sort((x, y) => compareMembers(order, x.from, y.from) || compareMembers(order, x.to, y.to));
}
