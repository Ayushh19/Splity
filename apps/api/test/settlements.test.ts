import type { GroupBalances, GroupDetail, SettlementDetail, SettlementView } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

/**
 * You (admin), Arjun and Meera (real, joined by link), Rahul and Priya (placeholders).
 * Seeded: Arjun paid ₹1,000 split exactly you ₹500 / Arjun ₹500 → you owe Arjun ₹500.
 */
async function setup() {
  const you = await t.user('You');
  const created = (await you.post('/groups', { name: 'Flat', currency: 'INR', placeholders: ['Rahul', 'Priya'] })).body as GroupDetail;
  const token = created.inviteUrl!.split('/join/')[1];
  const arjun = await t.user('Arjun');
  const meera = await t.user('Meera');
  await arjun.post(`/invites/${token}/join`, {});
  const g = (await meera.post(`/invites/${token}/join`, {})).body as GroupDetail;
  const id = (name: string) => g.members.find((m) => m.displayName === name)!.id;
  const ids = { you: id('You'), arjun: id('Arjun'), meera: id('Meera'), rahul: id('Rahul'), priya: id('Priya') };
  await you.post(`/groups/${g.id}/expenses`, {
    description: 'Groceries',
    expenseDate: '2026-10-01',
    amountMinor: 100000,
    payers: [{ memberId: ids.arjun, paidMinor: 100000 }],
    split: { method: 'exact', amounts: [{ memberId: ids.you, amountMinor: 50000 }, { memberId: ids.arjun, amountMinor: 50000 }] },
  });
  const pay = (by: typeof you, from: string, to: string, amountMinor: number) =>
    by.post(`/groups/${g.id}/settlements`, { fromMember: from, toMember: to, amountMinor, settledOn: '2026-10-01', method: 'upi' });
  const balances = async () => ((await you.get(`/groups/${g.id}/balances`)).body as GroupBalances).simplified;
  return { g, you, arjun, meera, ids, pay, balances };
}

describe('recording payments', () => {
  it('a full payment settles the debt and is logged', async () => {
    const { g, you, ids, pay, balances } = await setup();
    expect(await balances()).toEqual([{ from: ids.you, to: ids.arjun, amountMinor: 50000 }]);
    const res = await pay(you, ids.you, ids.arjun, 50000);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ recordedBy: ids.you, method: 'upi', version: 1, disputedBy: null });
    expect(await balances()).toEqual([]);
    const [latest] = (await you.get(`/groups/${g.id}/activity`)).body;
    expect(latest).toMatchObject({ type: 'settlement.recorded', payload: { from: 'You', to: 'Arjun', amountMinor: 50000 } });
  });

  it('partial payments reduce the debt; overpaying flips it', async () => {
    const { you, ids, pay, balances } = await setup();
    await pay(you, ids.you, ids.arjun, 20000);
    expect(await balances()).toEqual([{ from: ids.you, to: ids.arjun, amountMinor: 30000 }]);
    await pay(you, ids.you, ids.arjun, 80000);
    expect(await balances()).toEqual([{ from: ids.arjun, to: ids.you, amountMinor: 50000 }]);
  });

  it('either party can record it; a third person cannot (between real users)', async () => {
    const { arjun, meera, ids, pay } = await setup();
    expect((await pay(arjun, ids.you, ids.arjun, 50000)).status).toBe(201);
    const third = await pay(meera, ids.you, ids.arjun, 50000);
    expect(third.status).toBe(403);
  });

  it('anyone can record for a placeholder, and it shows who recorded it', async () => {
    const { meera, ids, pay } = await setup();
    const res = await pay(meera, ids.rahul, ids.priya, 10000);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fromMember: ids.rahul, toMember: ids.priya, recordedBy: ids.meera });
  });

  it('rejects people outside the group, paying yourself and zero amounts', async () => {
    const { you, ids, pay } = await setup();
    const other = await setup();
    expect((await pay(you, ids.you, other.ids.arjun, 100)).status).toBe(400);
    expect((await pay(you, ids.you, ids.you, 100)).status).toBe(400);
    expect((await pay(you, ids.you, ids.arjun, 0)).status).toBe(400);
  });
});

describe('disputes', () => {
  it('the other party disputes; the recorder cannot; editing clears it', async () => {
    const { g, you, arjun, ids, pay, balances } = await setup();
    const s = (await pay(you, ids.you, ids.arjun, 50000)).body as SettlementView;

    expect((await you.post(`/groups/${g.id}/settlements/${s.id}/dispute`, { version: 1 })).status).toBe(403);
    const disputed = await arjun.post(`/groups/${g.id}/settlements/${s.id}/dispute`, { version: 1, note: 'Only got ₹300' });
    expect(disputed.body).toMatchObject({ disputedBy: ids.arjun, disputeNote: 'Only got ₹300', version: 2 });
    // Still counts while disputed.
    expect(await balances()).toEqual([]);

    const edited = await you.put(`/groups/${g.id}/settlements/${s.id}`, { amountMinor: 30000, settledOn: '2026-10-01', method: 'upi', version: 2 });
    expect(edited.body).toMatchObject({ amountMinor: 30000, disputedBy: null, disputeNote: null, version: 3 });
    expect(await balances()).toEqual([{ from: ids.you, to: ids.arjun, amountMinor: 20000 }]);

    const detail = (await you.get(`/groups/${g.id}/settlements/${s.id}`)).body as SettlementDetail;
    expect(detail.history.map((h) => [h.version, h.action, h.actorName])).toEqual([
      [1, 'create', 'You'],
      [2, 'dispute', 'Arjun'],
      [3, 'update', 'You'],
    ]);
  });

  it('only the disputer can withdraw the dispute', async () => {
    const { g, you, arjun, ids, pay } = await setup();
    const s = (await pay(you, ids.you, ids.arjun, 50000)).body as SettlementView;
    await arjun.post(`/groups/${g.id}/settlements/${s.id}/dispute`, { version: 1 });
    expect((await you.post(`/groups/${g.id}/settlements/${s.id}/withdraw-dispute`, { version: 2 })).status).toBe(403);
    const withdrawn = await arjun.post(`/groups/${g.id}/settlements/${s.id}/withdraw-dispute`, { version: 2 });
    expect(withdrawn.body).toMatchObject({ disputedBy: null, version: 3 });
  });
});

describe('delete and restore', () => {
  it('deleting brings the debt back; stale versions conflict', async () => {
    const { g, you, ids, pay, balances } = await setup();
    const s = (await pay(you, ids.you, ids.arjun, 50000)).body as SettlementView;
    expect((await you.post(`/groups/${g.id}/settlements/${s.id}/delete`, { version: 1 })).body).toMatchObject({ deleted: true });
    expect(await balances()).toEqual([{ from: ids.you, to: ids.arjun, amountMinor: 50000 }]);
    expect((await you.get(`/groups/${g.id}/settlements`)).body).toEqual([]);
    expect((await you.post(`/groups/${g.id}/settlements/${s.id}/restore`, { version: 1 })).status).toBe(409);
    await you.post(`/groups/${g.id}/settlements/${s.id}/restore`, { version: 2 });
    expect(await balances()).toEqual([]);
  });
});

describe('removed members', () => {
  it('can still settle their own debt, but not record for others', async () => {
    const { g, you, arjun, ids, pay, balances } = await setup();
    // Overpay so Arjun owes you ₹500, then remove him.
    await pay(you, ids.you, ids.arjun, 100000);
    await you.del(`/groups/${g.id}/members/${ids.arjun}`);
    expect(await balances()).toEqual([{ from: ids.arjun, to: ids.you, amountMinor: 50000 }]);

    expect((await pay(arjun, ids.rahul, ids.priya, 100)).status).toBe(403);
    expect((await pay(arjun, ids.arjun, ids.you, 50000)).status).toBe(201);
    expect(await balances()).toEqual([]);
  });
});
