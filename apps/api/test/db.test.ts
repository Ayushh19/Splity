import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client';
import { expensePayers, expenses, expenseSplits, groupMembers, groups, settlements, users } from '../src/db/schema';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openDb());
});
afterAll(() => close());

let counter = 0;
async function user(name: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `${name.toLowerCase()}${++counter}@example.com`, displayName: name })
    .returning();
  return u!;
}

async function groupWith(creatorName: string, ...placeholders: string[]) {
  const creator = await user(creatorName);
  const [g] = await db
    .insert(groups)
    .values({ name: 'Flat 302', currency: 'INR', inviteToken: `tok-${++counter}`, createdBy: creator.id })
    .returning();
  const [admin] = await db
    .insert(groupMembers)
    .values({ groupId: g!.id, userId: creator.id, displayName: creatorName, role: 'admin', userSince: new Date() })
    .returning();
  const others = placeholders.length
    ? await db
        .insert(groupMembers)
        .values(placeholders.map((displayName) => ({ groupId: g!.id, displayName })))
        .returning()
    : [];
  return { group: g!, admin: admin!, others };
}

/** Insert an expense paid by `payer` and split `owed` among members, in one transaction. */
function insertExpense(
  groupId: string,
  createdBy: string,
  total: number,
  payers: { memberId: string; paidMinor: number }[],
  splits: { memberId: string; owedMinor: number }[],
) {
  return db.transaction(async (tx) => {
    const [e] = await tx
      .insert(expenses)
      .values({
        groupId,
        createdBy,
        description: 'Dinner',
        expenseDate: '2026-10-01',
        amountMinor: total,
        splitMethod: 'equal',
      })
      .returning();
    if (payers.length) await tx.insert(expensePayers).values(payers.map((p) => ({ ...p, expenseId: e!.id })));
    if (splits.length) await tx.insert(expenseSplits).values(splits.map((s) => ({ ...s, expenseId: e!.id })));
    return e!;
  });
}

/** Postgres errors may arrive wrapped (Drizzle) — search the cause chain for the constraint name. */
async function expectViolation(promise: Promise<unknown>, constraint: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected ${constraint} violation`).toBeDefined();
  const chain: string[] = [];
  for (let e = error as { message?: string; constraint?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    chain.push(String(e.constraint ?? ''), String(e.message ?? ''));
  }
  expect(chain.join('\n')).toContain(constraint);
}

describe('expense integrity (deferred trigger)', () => {
  it('accepts a balanced expense with multiple payers', async () => {
    const { group, admin, others } = await groupWith('You', 'Priya', 'Arjun');
    const [priya, arjun] = others;
    const e = await insertExpense(
      group.id,
      admin.id,
      300000,
      [
        { memberId: priya!.id, paidMinor: 200000 },
        { memberId: arjun!.id, paidMinor: 100000 },
      ],
      [admin, priya!, arjun!].map((m) => ({ memberId: m.id, owedMinor: 100000 })),
    );
    const rows = await db.select().from(expensePayers).where(eq(expensePayers.expenseId, e.id));
    expect(rows).toHaveLength(2);
  });

  it('rejects payers that do not add up to the total', async () => {
    const { group, admin } = await groupWith('You', 'Priya');
    await expectViolation(
      insertExpense(group.id, admin.id, 300000, [{ memberId: admin.id, paidMinor: 250000 }], [
        { memberId: admin.id, owedMinor: 300000 },
      ]),
      'expense_payers_sum',
    );
  });

  it('rejects splits that do not add up to the total', async () => {
    const { group, admin, others } = await groupWith('You', 'Priya');
    await expectViolation(
      insertExpense(group.id, admin.id, 100000, [{ memberId: admin.id, paidMinor: 100000 }], [
        { memberId: admin.id, owedMinor: 33333 },
        { memberId: others[0]!.id, owedMinor: 33333 },
      ]),
      'expense_splits_sum',
    );
  });

  it('rejects an expense with no payers', async () => {
    const { group, admin } = await groupWith('You');
    await expectViolation(
      insertExpense(group.id, admin.id, 100, [], [{ memberId: admin.id, owedMinor: 100 }]),
      'expense_payers_sum',
    );
  });

  it('rejects a split member from another group', async () => {
    const a = await groupWith('You');
    const b = await groupWith('Stranger');
    await expectViolation(
      insertExpense(a.group.id, a.admin.id, 100, [{ memberId: a.admin.id, paidMinor: 100 }], [
        { memberId: b.admin.id, owedMinor: 100 },
      ]),
      'expense_members_in_group',
    );
  });

  it('rejects changing the total without updating payers and splits', async () => {
    const { group, admin } = await groupWith('You');
    const e = await insertExpense(group.id, admin.id, 100, [{ memberId: admin.id, paidMinor: 100 }], [
      { memberId: admin.id, owedMinor: 100 },
    ]);
    await expectViolation(
      db.update(expenses).set({ amountMinor: 200 }).where(eq(expenses.id, e.id)),
      'expense_payers_sum',
    );
  });
});

describe('membership constraints', () => {
  it('allows many placeholders but a real user only once per group', async () => {
    const { group, admin } = await groupWith('You', 'Rahul', 'Rahul K');
    await expectViolation(
      db.insert(groupMembers).values({ groupId: group.id, userId: admin.userId, displayName: 'You again', userSince: new Date() }),
      'group_members_one_per_user',
    );
  });

  it('does not allow a placeholder to be admin', async () => {
    const { group } = await groupWith('You');
    await expectViolation(
      db.insert(groupMembers).values({ groupId: group.id, displayName: 'Rahul', role: 'admin' }),
      'group_members_admin_is_user',
    );
  });

  it('assigns increasing sort keys in join order', async () => {
    const { admin, others } = await groupWith('You', 'Priya', 'Arjun');
    const keys = [admin, ...others].map((m) => m.sortKey);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('settlement constraints', () => {
  it('rejects a settlement with a member from another group', async () => {
    const a = await groupWith('You');
    const b = await groupWith('Stranger');
    await expectViolation(
      db.insert(settlements).values({
        groupId: a.group.id,
        fromMember: a.admin.id,
        toMember: b.admin.id,
        recordedBy: a.admin.id,
        amountMinor: 500,
        settledOn: '2026-10-01',
      }),
      'settlements_to_member',
    );
  });

  it('only lets the other party dispute', async () => {
    const { group, admin, others } = await groupWith('You', 'Priya');
    await expectViolation(
      db.insert(settlements).values({
        groupId: group.id,
        fromMember: admin.id,
        toMember: others[0]!.id,
        recordedBy: admin.id,
        amountMinor: 500,
        settledOn: '2026-10-01',
        disputedAt: new Date(),
        disputedBy: admin.id,
      }),
      'settlements_disputed',
    );
  });
});

describe('optimistic locking', () => {
  it('a second save based on a stale version updates nothing', async () => {
    const { group, admin } = await groupWith('You');
    const e = await insertExpense(group.id, admin.id, 100, [{ memberId: admin.id, paidMinor: 100 }], [
      { memberId: admin.id, owedMinor: 100 },
    ]);
    const save = (seen: number, description: string) =>
      db
        .update(expenses)
        .set({ description, version: seen + 1 })
        .where(and(eq(expenses.id, e.id), eq(expenses.version, seen)))
        .returning({ id: expenses.id });

    expect(await save(1, 'Priya’s fix')).toHaveLength(1);
    expect(await save(1, 'Arjun’s stale edit')).toHaveLength(0);
    const [row] = await db.select().from(expenses).where(eq(expenses.id, e.id));
    expect(row).toMatchObject({ description: 'Priya’s fix', version: 2 });
  });
});
