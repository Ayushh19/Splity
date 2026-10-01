import { inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { groupMembers } from '../db/schema';

export interface MemberLedger {
  /** Net balance from non-deleted expenses and settlements: + owed money, − owes money. */
  netMinor: number;
  /** Appears in any expense or settlement, including deleted (restorable) ones. */
  hasHistory: boolean;
}

/**
 * Net balance and history flag for every member of the given groups.
 * Same arithmetic as `netBalances` in @splity/shared, done in SQL so it scales with rows.
 */
export async function memberLedgers(db: DbOrTx, groupIds: string[]): Promise<Map<string, MemberLedger>> {
  const result = new Map<string, MemberLedger>();
  if (groupIds.length === 0) return result;

  const members = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds));
  for (const m of members) result.set(m.id, { netMinor: 0, hasHistory: false });

  const ids = sql.join(
    groupIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{ member_id: string; net: string; refs: string }>(sql`
    SELECT member_id,
           SUM(CASE WHEN deleted THEN 0 ELSE delta END)::text AS net,
           COUNT(*)::text AS refs
    FROM (
      SELECT p.member_id, p.paid_minor AS delta, e.deleted_at IS NOT NULL AS deleted
        FROM expense_payers p JOIN expenses e ON e.id = p.expense_id
       WHERE e.group_id IN (${ids})
      UNION ALL
      SELECT s.member_id, -s.owed_minor, e.deleted_at IS NOT NULL
        FROM expense_splits s JOIN expenses e ON e.id = s.expense_id
       WHERE e.group_id IN (${ids})
      UNION ALL
      SELECT from_member, amount_minor, deleted_at IS NOT NULL FROM settlements WHERE group_id IN (${ids})
      UNION ALL
      SELECT to_member, -amount_minor, deleted_at IS NOT NULL FROM settlements WHERE group_id IN (${ids})
    ) entries
    GROUP BY member_id
  `);
  for (const row of rows.rows) {
    result.set(row.member_id, { netMinor: Number(row.net), hasHistory: Number(row.refs) > 0 });
  }
  return result;
}
