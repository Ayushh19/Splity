import type { ExpenseDetail, ExpenseView, GroupBalances, GroupDetail, Profile, SettlementView } from '@splity/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

type User = Awaited<ReturnType<typeof t.user>>;

/** Ayush (admin) + placeholder "Rahul"; Rahul then joins as a *new* member "Rahul K" (the duplicate). */
async function duplicateRahul() {
  const ayush = await t.user('Ayush');
  const created = (await ayush.post('/groups', { name: 'Flat', currency: 'INR', placeholders: ['Rahul'] })).body as GroupDetail;
  const rahulK = await t.user('Rahul K');
  await rahulK.post(`/invites/${created.inviteUrl!.split('/join/')[1]}/join`, {});
  const g = (await ayush.get(`/groups/${created.id}`)).body as GroupDetail;
  const id = (n: string) => g.members.find((m) => m.displayName === n)!.id;
  return { g, ayush, rahulK, ids: { ayush: id('Ayush'), rahul: id('Rahul'), rahulK: id('Rahul K') } };
}

const expense = (payer: string, participants: string[], amountMinor = 300000) => ({
  description: 'Dinner',
  expenseDate: '2026-10-01',
  amountMinor,
  payers: [{ memberId: payer, paidMinor: amountMinor }],
  split: { method: 'equal', participants },
});

const nets = async (u: User, groupId: string) =>
  Object.fromEntries(((await u.get(`/groups/${groupId}/balances`)).body as GroupBalances).net.map((n) => [n.memberId, n.netMinor]));

describe('merging a placeholder', () => {
  it('moves expenses and payments, combining shares and keeping every total', async () => {
    const { g, ayush, ids } = await duplicateRahul();
    const onlyRahul = (await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush, ids.rahul]))).body as ExpenseView;
    const both = (await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush, ids.rahul, ids.rahulK]))).body as ExpenseView;
    const toAyush = (await ayush.post(`/groups/${g.id}/settlements`, { fromMember: ids.rahul, toMember: ids.ayush, amountMinor: 20000, settledOn: '2026-10-01' })).body as SettlementView;
    const between = (await ayush.post(`/groups/${g.id}/settlements`, { fromMember: ids.rahul, toMember: ids.rahulK, amountMinor: 5000, settledOn: '2026-10-01' })).body as SettlementView;
    const before = await nets(ayush, g.id);

    const res = await ayush.post(`/groups/${g.id}/members/${ids.rahul}/merge`, { intoMemberId: ids.rahulK });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as GroupDetail).members.map((m) => m.displayName)).toEqual(['Ayush', 'Rahul K']);

    // Balances: Rahul K now carries both; Ayush unchanged.
    const after = await nets(ayush, g.id);
    expect(after[ids.ayush]).toBe(before[ids.ayush]);
    expect(after[ids.rahulK]).toBe(before[ids.rahulK]! + before[ids.rahul]!);
    expect(after[ids.rahul]).toBeUndefined();

    // Expense with only Rahul: re-pointed, still an equal split.
    const e1 = (await ayush.get(`/groups/${g.id}/expenses/${onlyRahul.id}`)).body as ExpenseDetail;
    expect(e1.expense).toMatchObject({ splitMethod: 'equal', version: 2 });
    expect(e1.expense.splits.map((s) => [s.memberId, s.owedMinor])).toEqual([[ids.ayush, 150000], [ids.rahulK, 150000]]);
    expect(e1.history.at(-1)).toMatchObject({ action: 'merge_repoint', actorName: 'Ayush' });

    // Expense with both: one combined share, frozen as exact amounts.
    const e2 = (await ayush.get(`/groups/${g.id}/expenses/${both.id}`)).body as ExpenseDetail;
    expect(e2.expense.splitMethod).toBe('exact');
    expect(e2.expense.splits.map((s) => [s.memberId, s.owedMinor, s.exactMinor])).toEqual([
      [ids.ayush, 100000, 100000],
      [ids.rahulK, 200000, 200000],
    ]);

    // Payments: to Ayush re-pointed; between the two deleted (it would be a self-payment).
    const p1 = (await ayush.get(`/groups/${g.id}/settlements/${toAyush.id}`)).body.settlement as SettlementView;
    expect(p1).toMatchObject({ fromMember: ids.rahulK, toMember: ids.ayush, deleted: false });
    const p2 = (await ayush.get(`/groups/${g.id}/settlements/${between.id}`)).body.settlement as SettlementView;
    expect(p2.deleted).toBe(true);

    const [latest] = (await ayush.get(`/groups/${g.id}/activity`)).body;
    expect(latest).toMatchObject({ type: 'member.merged', payload: { from: 'Rahul', into: 'Rahul K', expenses: 2, payments: 2, deletedPayments: 1 } });
  });

  it('admin only; placeholder into a real member only', async () => {
    const { g, ayush, rahulK, ids } = await duplicateRahul();
    expect((await rahulK.post(`/groups/${g.id}/members/${ids.rahul}/merge`, { intoMemberId: ids.rahulK })).status).toBe(403);
    expect((await ayush.post(`/groups/${g.id}/members/${ids.rahulK}/merge`, { intoMemberId: ids.ayush })).status).toBe(400);
    const placeholder2 = (await ayush.post(`/groups/${g.id}/members`, { displayName: 'Kabir' })).body.members.find((m: { displayName: string }) => m.displayName === 'Kabir').id;
    expect((await ayush.post(`/groups/${g.id}/members/${ids.rahul}/merge`, { intoMemberId: placeholder2 })).status).toBe(400);
  });
});

describe('archiving', () => {
  it('needs everyone settled; then the group is read-only and moves to History', async () => {
    const { g, ayush, rahulK, ids } = await duplicateRahul();
    await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush, ids.rahulK], 100000));

    const blocked = await ayush.post(`/groups/${g.id}/archive`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: 'nonzero_balance', unsettled: expect.any(Array) });
    expect((await rahulK.post(`/groups/${g.id}/archive`)).status).toBe(403);

    await rahulK.post(`/groups/${g.id}/settlements`, { fromMember: ids.rahulK, toMember: ids.ayush, amountMinor: 50000, settledOn: '2026-10-01' });
    const archived = await ayush.post(`/groups/${g.id}/archive`);
    expect(archived.body).toMatchObject({ archived: true });

    expect((await ayush.get('/groups')).body.find((x: { id: string }) => x.id === g.id)).toBeUndefined();
    expect((await ayush.get('/groups?archived=1')).body).toMatchObject([{ id: g.id, archived: true }]);
    expect((await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush]))).body.error).toBe('archived');
    expect((await ayush.post(`/groups/${g.id}/members`, { displayName: 'Late' })).body.error).toBe('archived');
    expect((await t.request(`/api/invites/${g.inviteUrl!.split('/join/')[1]}`)).status).toBe(404);
    // Reading still works.
    expect((await rahulK.get(`/groups/${g.id}/expenses`)).status).toBe(200);

    const back = await ayush.post(`/groups/${g.id}/unarchive`);
    expect(back.body).toMatchObject({ archived: false });
    expect((await ayush.post(`/groups/${g.id}/members`, { displayName: 'Late' })).status).toBe(201);
  });
});

describe('deleting an account', () => {
  it('is blocked while any balance is non-zero', async () => {
    const { g, ayush, rahulK, ids } = await duplicateRahul();
    await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush, ids.rahulK], 100000));
    const check = await rahulK.get('/me/deletion-check');
    expect(check.body).toMatchObject({ canDelete: false, blockers: [{ groupId: g.id, name: 'Flat', netMinor: -50000 }] });
    const res = await rahulK.post('/me/delete', { confirm: 'DELETE' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nonzero_balance');
  });

  it('needs the typed confirmation', async () => {
    const lone = await t.user('Lone');
    expect((await lone.post('/me/delete', {})).status).toBe(400);
    expect((await lone.post('/me/delete', { confirm: 'yes' })).status).toBe(400);
  });

  it('removes personal data, keeps history as "Deleted user", hands admin over, ends sessions', async () => {
    const { g, ayush, rahulK, ids } = await duplicateRahul();
    await ayush.post(`/groups/${g.id}/expenses`, expense(ids.ayush, [ids.ayush, ids.rahulK], 100000));
    await rahulK.post(`/groups/${g.id}/settlements`, { fromMember: ids.rahulK, toMember: ids.ayush, amountMinor: 50000, settledOn: '2026-10-01' });
    const ayushId = (await ayush.get('/me')).body.id as string;
    await ayush.patch('/me', { upiId: 'ayush@okaxis' });

    expect((await ayush.get('/me/deletion-check')).body).toEqual({ canDelete: true, blockers: [] });
    expect((await ayush.post('/me/delete', { confirm: 'DELETE' })).status).toBe(204);

    expect((await ayush.get('/me')).status).toBe(401);
    const [row] = await t.db.select().from(users).where(eq(users.id, ayushId));
    expect(row).toMatchObject({ email: `deleted-${ayushId}@deleted.invalid`, displayName: 'Deleted user', upiId: null, photoUrl: null });
    expect(row!.deletedAt).not.toBeNull();

    const view = (await rahulK.get(`/groups/${g.id}`)).body as GroupDetail;
    expect(view.members.find((m) => m.id === ids.ayush)).toMatchObject({ displayName: 'Deleted user', status: 'removed', upiId: null });
    expect(view.you.role).toBe('admin');
    const expenses = (await rahulK.get(`/groups/${g.id}/expenses`)).body as ExpenseView[];
    expect(expenses[0]!.payers[0]!.memberId).toBe(ids.ayush);
  });

  it('signing up again with the same email starts a fresh account', async () => {
    const before = await t.signIn('comeback@example.com');
    const oldId = ((await (await t.request('/api/me', { headers: { Cookie: before } })).json()) as Profile).id;
    await t.request('/api/me/delete', {
      method: 'POST',
      headers: { Cookie: before, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const after = await t.signIn('comeback@example.com');
    const fresh = (await (await t.request('/api/me', { headers: { Cookie: after } })).json()) as Profile;
    expect(fresh.id).not.toBe(oldId);
    expect(fresh.displayName).toBe('');
  });
});
