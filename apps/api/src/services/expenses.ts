import {
  computeSplit,
  convertWithRate,
  currencyExponent,
  MAX_EXPENSE_MAJOR_UNITS,
  memberOrder,
  MoneyError,
  validatePayers,
  type ExpenseSnapshot,
  type ExpenseView,
  type MemberOrder,
  type ParsedExpenseInput,
} from '@splity/shared';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { expensePayers, expenses, expenseSplits, groupMembers, revisions } from '../db/schema';
import { HttpError, notFound } from '../http';
import { logActivity } from './activity';
import type { Group } from './membership';

type ExpenseRow = typeof expenses.$inferSelect;

const invalid = (message: string) => new HttpError(400, 'invalid', message);

export async function groupOrder(db: DbOrTx, groupId: string) {
  const members = await db
    .select({ id: groupMembers.id, sortKey: groupMembers.sortKey, status: groupMembers.status })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return { members: new Map(members.map((m) => [m.id, m])), order: memberOrder(members) as MemberOrder };
}

/** Latest date allowed for an expense: "tomorrow" in the furthest-ahead time zone (UTC+14). */
function maxExpenseDate(): string {
  const ahead = new Date(Date.now() + (14 + 24) * 3600_000);
  return ahead.toISOString().slice(0, 10);
}

export interface PreparedExpense {
  amountMinor: number;
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  fxRate: string | null;
  payers: { memberId: string; paidMinor: number }[];
  splits: { memberId: string; owedMinor: number; shares: number | null; exactMinor: number | null }[];
}

/**
 * Validate an expense against its group and compute what each person owes,
 * using the same @splity/shared functions the form previews with.
 * `existingMemberIds`: on edit, removed members already in the expense may stay.
 */
export async function prepareExpense(
  db: DbOrTx,
  group: Group,
  input: ParsedExpenseInput,
  existingMemberIds: ReadonlySet<string> = new Set(),
): Promise<PreparedExpense> {
  if (input.expenseDate > maxExpenseDate()) throw invalid('The date can be at most one day in the future');

  let amountMinor = input.amountMinor;
  if (input.foreign) {
    if (input.foreign.currency === group.currency) throw invalid(`Enter ${group.currency} amounts directly`);
    try {
      amountMinor = convertWithRate(input.foreign.amountMinor, input.foreign.currency, input.foreign.rate, group.currency);
    } catch (e) {
      if (e instanceof MoneyError) throw invalid(e.message);
      throw e;
    }
    if (amountMinor <= 0) throw invalid('The converted amount is zero; check the exchange rate');
  }
  if (amountMinor > MAX_EXPENSE_MAJOR_UNITS * 10 ** currencyExponent(group.currency)) {
    throw invalid('That amount is too large');
  }

  const { members, order } = await groupOrder(db, group.id);
  const referenced = [
    ...input.payers.map((p) => p.memberId),
    ...(input.split.method === 'equal'
      ? input.split.participants
      : input.split.method === 'exact'
        ? input.split.amounts.map((a) => a.memberId)
        : input.split.shares.map((s) => s.memberId)),
  ];
  for (const id of referenced) {
    const m = members.get(id);
    if (!m || m.status === 'merged') throw invalid('Someone in this expense is not in the group');
    if (m.status === 'removed' && !existingMemberIds.has(id)) {
      throw invalid('Removed members can’t be added to an expense');
    }
  }

  try {
    const payers = validatePayers(amountMinor, input.payers, order);
    const owed = computeSplit(amountMinor, input.split, order);
    const split = input.split;
    const splits = owed.map((o) => ({
      memberId: o.memberId,
      owedMinor: o.owedMinor,
      shares: split.method === 'shares' ? (split.shares.find((s) => s.memberId === o.memberId)?.shares ?? null) : null,
      exactMinor:
        split.method === 'exact' ? (split.amounts.find((a) => a.memberId === o.memberId)?.amountMinor ?? null) : null,
    }));
    return {
      amountMinor,
      originalCurrency: input.foreign?.currency ?? null,
      originalAmountMinor: input.foreign?.amountMinor ?? null,
      fxRate: input.foreign?.rate ?? null,
      payers,
      splits,
    };
  } catch (e) {
    if (e instanceof MoneyError) throw invalid(e.message);
    throw e;
  }
}

/** Load expenses with their payers and splits, newest first. */
export async function loadExpenses(
  db: DbOrTx,
  groupId: string,
  { ids, deleted }: { ids?: string[]; deleted?: boolean } = {},
): Promise<ExpenseView[]> {
  const rows = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        ids ? inArray(expenses.id, ids) : undefined,
        deleted === undefined ? undefined : deleted ? isNotNull(expenses.deletedAt) : isNull(expenses.deletedAt),
      ),
    )
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
  if (rows.length === 0) return [];

  const expenseIds = rows.map((r) => r.id);
  const [payers, splits] = await Promise.all([
    db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds)),
    db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds)),
  ]);
  const { order } = await groupOrder(db, groupId);
  const rank = (id: string) => order.get(id) ?? 0;

  return rows.map((row) => toView(
    row,
    payers.filter((p) => p.expenseId === row.id).sort((a, b) => rank(a.memberId) - rank(b.memberId)),
    splits.filter((s) => s.expenseId === row.id).sort((a, b) => rank(a.memberId) - rank(b.memberId)),
  ));
}

export async function loadExpense(db: DbOrTx, groupId: string, expenseId: string): Promise<ExpenseView> {
  const [view] = await loadExpenses(db, groupId, { ids: [expenseId] });
  if (!view) throw notFound();
  return view;
}

function toView(
  row: ExpenseRow,
  payers: (typeof expensePayers.$inferSelect)[],
  splits: (typeof expenseSplits.$inferSelect)[],
): ExpenseView {
  return {
    id: row.id,
    groupId: row.groupId,
    description: row.description,
    category: row.category as ExpenseView['category'],
    notes: row.notes,
    expenseDate: row.expenseDate,
    amountMinor: row.amountMinor,
    splitMethod: row.splitMethod,
    originalCurrency: row.originalCurrency,
    originalAmountMinor: row.originalAmountMinor,
    // numeric(20,10) comes back padded ("2.3500000000"); show it as entered.
    fxRate: row.fxRate === null ? null : row.fxRate.replace(/\.?0+$/, ''),
    payers: payers.map((p) => ({ memberId: p.memberId, paidMinor: p.paidMinor })),
    splits: splits.map((s) => ({ memberId: s.memberId, owedMinor: s.owedMinor, shares: s.shares, exactMinor: s.exactMinor })),
    deleted: row.deletedAt !== null,
    createdBy: row.createdBy,
    recurringSeriesId: row.recurringSeriesId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function snapshotOf(view: ExpenseView): ExpenseSnapshot {
  return {
    description: view.description,
    category: view.category,
    notes: view.notes,
    expenseDate: view.expenseDate,
    amountMinor: view.amountMinor,
    splitMethod: view.splitMethod,
    originalCurrency: view.originalCurrency,
    originalAmountMinor: view.originalAmountMinor,
    fxRate: view.fxRate,
    payers: view.payers,
    splits: view.splits,
    deleted: view.deleted,
  };
}

/** Replace payers and splits of an expense (inside the caller's transaction). */
export async function writeLines(tx: DbOrTx, expenseId: string, prepared: PreparedExpense): Promise<void> {
  await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
  await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
  await tx.insert(expensePayers).values(prepared.payers.map((p) => ({ ...p, expenseId })));
  await tx.insert(expenseSplits).values(prepared.splits.map((s) => ({ ...s, expenseId })));
}

/** Record the revision and the matching activity event for a change that just happened. */
export async function recordChange(
  tx: DbOrTx,
  group: Group,
  view: ExpenseView,
  action: 'create' | 'update' | 'delete' | 'restore',
  actorMember: string | null,
): Promise<string> {
  const [revision] = await tx
    .insert(revisions)
    .values({
      entityType: 'expense',
      entityId: view.id,
      version: view.version,
      action,
      actorMember,
      snapshot: snapshotOf(view),
    })
    .returning({ id: revisions.id });
  const type = ({ create: 'expense.created', update: 'expense.updated', delete: 'expense.deleted', restore: 'expense.restored' } as const)[action];
  return logActivity(tx, {
    groupId: group.id,
    actorMember,
    type,
    entityType: 'expense',
    entityId: view.id,
    revisionId: revision!.id,
    payload: { description: view.description, amountMinor: view.amountMinor, currency: group.currency },
  });
}
