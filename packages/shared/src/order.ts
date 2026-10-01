import { MoneyError, type MemberId } from './money';

/**
 * Member ordering by `group_members.sort_key`. Every place that needs a fixed
 * order — handing out leftover paise, matching debtors to creditors, breaking
 * ties — goes through this, so results are reproducible on client and server.
 */
export type MemberOrder = ReadonlyMap<MemberId, number>;

export function memberOrder(members: readonly { id: MemberId; sortKey: number }[]): MemberOrder {
  return new Map(members.map((m) => [m.id, m.sortKey]));
}

export function rankOf(order: MemberOrder, id: MemberId): number {
  const rank = order.get(id);
  if (rank === undefined) throw new MoneyError('UNKNOWN_MEMBER', `Member ${id} is not in this group`);
  return rank;
}

export function compareMembers(order: MemberOrder, a: MemberId, b: MemberId): number {
  return rankOf(order, a) - rankOf(order, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export function sortByMember<T>(order: MemberOrder, items: readonly T[], idOf: (item: T) => MemberId): T[] {
  // Validate every member up front: sort() skips the comparator for 0–1 items.
  for (const item of items) rankOf(order, idOf(item));
  return [...items].sort((x, y) => compareMembers(order, idOf(x), idOf(y)));
}
