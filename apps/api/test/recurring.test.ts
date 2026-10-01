import type { ExpenseDetail, ExpenseView, GroupDetail, MemberView, RecurringSeriesView } from '@splity/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());
beforeEach(() => {
  t.clock.today = '2026-10-01';
});

type User = Awaited<ReturnType<typeof t.user>>;

/** Ayush (admin, with a device) and placeholders Priya and Arjun, in that order. */
async function flat() {
  const ayush = await t.user('Ayush');
  await ayush.post('/push/subscriptions', { endpoint: `https://push.example/ayush-${Math.random()}`, keys: { p256dh: 'k', auth: 'a' } });
  const g = (await ayush.post('/groups', { name: 'Flat', currency: 'INR', placeholders: ['Priya', 'Arjun'] })).body as GroupDetail;
  const [me, priya, arjun] = g.members as [MemberView, MemberView, MemberView];
  return { ayush, g, ids: { me: me.id, priya: priya.id, arjun: arjun.id } };
}

const rent = (payer: string, split: unknown, over: Record<string, unknown> = {}) => ({
  description: 'Rent',
  category: 'rent',
  expenseDate: '2026-10-01',
  amountMinor: 3000000,
  payers: [{ memberId: payer, paidMinor: 3000000 }],
  split,
  repeat: { frequency: 'monthly' },
  ...over,
});

async function run(today: string, groupId: string) {
  t.clock.today = today;
  return t.recurring.runDue(today, groupId);
}
const series = async (u: User, groupId: string) => (await u.get(`/groups/${groupId}/recurring`)).body as RecurringSeriesView[];
const occurrences = async (u: User, groupId: string) =>
  ((await u.get(`/groups/${groupId}/expenses`)).body as ExpenseView[]).filter((e) => e.recurringSeriesId).sort((a, b) => a.expenseDate.localeCompare(b.expenseDate));

describe('creating a repeating expense', () => {
  it('the expense is the first occurrence; the next is due next month', async () => {
    const { ayush, g, ids } = await flat();
    const res = await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya, ids.arjun] }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.recurringSeriesId).toBeTruthy();
    expect(await series(ayush, g.id)).toMatchObject([
      { frequency: 'monthly', anchorDay: 1, nextDue: '2026-11-01', status: 'active', occurrences: 1, latest: { description: 'Rent' } },
    ]);
  });

  it("doesn't back-fill: an old first date starts from today", async () => {
    const { ayush, g, ids } = await flat();
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya] }, { expenseDate: '2026-06-01' }));
    await run('2026-10-01', g.id);
    expect((await occurrences(ayush, g.id)).map((e) => e.expenseDate)).toEqual(['2026-06-01', '2026-10-01']);
    expect((await series(ayush, g.id))[0]!.nextDue).toBe('2026-11-01');
  });
});

describe('the recurring job', () => {
  it('creates due occurrences as copies, by the system, exactly once', async () => {
    const { ayush, g, ids } = await flat();
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya, ids.arjun] }));

    expect(await run('2026-10-31', g.id)).toEqual({ created: 0, paused: 0 });
    expect(await run('2026-11-01', g.id)).toEqual({ created: 1, paused: 0 });
    expect(await run('2026-11-01', g.id)).toEqual({ created: 0, paused: 0 });

    const [, nov] = await occurrences(ayush, g.id);
    expect(nov).toMatchObject({ expenseDate: '2026-11-01', amountMinor: 3000000, createdBy: null });
    expect(nov!.splits.map((s) => s.owedMinor)).toEqual([1000000, 1000000, 1000000]);
    const detail = (await ayush.get(`/groups/${g.id}/expenses/${nov!.id}`)).body as ExpenseDetail;
    expect(detail.history[0]).toMatchObject({ action: 'create', actorName: null });
  });

  it('copies the latest occurrence, so editing it changes what comes next', async () => {
    const { ayush, g, ids } = await flat();
    const first = (await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya, ids.arjun] }))).body as ExpenseView;
    const { repeat: _repeat, ...edit } = rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya] }, { amountMinor: 3200000, payers: [{ memberId: ids.me, paidMinor: 3200000 }] });
    await ayush.put(`/groups/${g.id}/expenses/${first.id}`, { ...edit, version: 1 });
    await run('2026-11-01', g.id);
    const [, nov] = await occurrences(ayush, g.id);
    expect(nov).toMatchObject({ amountMinor: 3200000 });
    expect(nov!.splits.map((s) => s.memberId)).toEqual([ids.me, ids.priya]);
  });

  it('catches up every date missed while the job was not running', async () => {
    const { ayush, g, ids } = await flat();
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya] }));
    expect((await run('2027-01-15', g.id)).created).toBe(3);
    expect((await occurrences(ayush, g.id)).map((e) => e.expenseDate)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect((await series(ayush, g.id))[0]!.nextDue).toBe('2027-02-01');
  });

  it('skips removed members in an equal split', async () => {
    const { ayush, g, ids } = await flat();
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya, ids.arjun] }));
    await ayush.del(`/groups/${g.id}/members/${ids.arjun}`);
    await run('2026-11-01', g.id);
    const [, nov] = await occurrences(ayush, g.id);
    expect(nov!.splits.map((s) => [s.memberId, s.owedMinor])).toEqual([
      [ids.me, 1500000],
      [ids.priya, 1500000],
    ]);
  });
});

describe('pausing', () => {
  const exactSplit = (ids: Record<string, string>) => ({
    method: 'exact',
    amounts: [
      { memberId: ids.me, amountMinor: 1200000 },
      { memberId: ids.priya, amountMinor: 1000000 },
      { memberId: ids.arjun, amountMinor: 800000 },
    ],
  });

  it('pauses when someone in an exact split was removed, tells the creator, and resumes only once fixed', async () => {
    const { ayush, g, ids } = await flat();
    const first = (await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, exactSplit(ids)))).body as ExpenseView;
    await ayush.del(`/groups/${g.id}/members/${ids.arjun}`);
    await t.notifier.idle();
    const start = t.pushes.length;

    expect(await run('2026-11-01', g.id)).toEqual({ created: 0, paused: 1 });
    expect((await series(ayush, g.id))[0]).toMatchObject({ status: 'paused', pausedReason: 'removed_participant', occurrences: 1 });
    await t.notifier.idle();
    expect(t.pushes.slice(start).map((p) => p.payload.body)).toEqual([
      '"Rent" stopped repeating because someone in its exact split was removed from the group. Fix the latest one and resume it.',
    ]);
    expect((await ayush.get(`/groups/${g.id}/activity`)).body[0]).toMatchObject({ type: 'recurring.paused', actorName: null });

    const [s] = await series(ayush, g.id);
    const blocked = await ayush.post(`/groups/${g.id}/recurring/${s!.id}/resume`);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: 'conflict', expenseId: first.id });

    // Fix the latest occurrence, then resume on 15 Nov: 1 Nov is skipped, next is 1 Dec.
    const { repeat: _r, ...fixed } = rent(ids.me, { method: 'exact', amounts: [{ memberId: ids.me, amountMinor: 1600000 }, { memberId: ids.priya, amountMinor: 1400000 }] });
    await ayush.put(`/groups/${g.id}/expenses/${first.id}`, { ...fixed, version: 1 });
    t.clock.today = '2026-11-15';
    const resumed = await ayush.post(`/groups/${g.id}/recurring/${s!.id}/resume`);
    expect(resumed.body).toMatchObject({ status: 'active', pausedReason: null, nextDue: '2026-12-01' });
    await run('2026-12-01', g.id);
    expect((await occurrences(ayush, g.id)).map((e) => e.expenseDate)).toEqual(['2026-10-01', '2026-12-01']);
  });

  it('pauses when the payer was removed', async () => {
    const ayush = await t.user('Ayush');
    const g = (await ayush.post('/groups', { name: 'Flat', currency: 'INR', placeholders: ['Landlord payer'] })).body as GroupDetail;
    const [me, payer] = g.members as [MemberView, MemberView];
    await ayush.post(`/groups/${g.id}/expenses`, rent(payer.id, { method: 'equal', participants: [me.id, payer.id] }));
    await ayush.del(`/groups/${g.id}/members/${payer.id}`);
    await run('2026-11-01', g.id);
    expect((await series(ayush, g.id))[0]).toMatchObject({ status: 'paused', pausedReason: 'removed_payer' });
  });

  it('manual pause, resume and stop; a stopped series stays stopped', async () => {
    const { ayush, g, ids } = await flat();
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me, ids.priya] }));
    const [s] = await series(ayush, g.id);
    expect((await ayush.post(`/groups/${g.id}/recurring/${s!.id}/pause`)).body).toMatchObject({ status: 'paused', pausedReason: 'manual' });
    expect((await run('2026-12-15', g.id)).created).toBe(0);
    t.clock.today = '2026-12-15';
    expect((await ayush.post(`/groups/${g.id}/recurring/${s!.id}/resume`)).body).toMatchObject({ status: 'active', nextDue: '2027-01-01' });
    expect((await ayush.post(`/groups/${g.id}/recurring/${s!.id}/stop`)).body).toMatchObject({ status: 'stopped' });
    expect((await ayush.post(`/groups/${g.id}/recurring/${s!.id}/resume`)).status).toBe(409);
  });

  it('archiving the group pauses its series', async () => {
    const { ayush, g, ids } = await flat();
    // Ayush pays and owes it all: balances stay zero, so the group can be archived.
    await ayush.post(`/groups/${g.id}/expenses`, rent(ids.me, { method: 'equal', participants: [ids.me] }));
    expect((await ayush.post(`/groups/${g.id}/archive`)).status).toBe(200);
    expect((await series(ayush, g.id))[0]).toMatchObject({ status: 'paused', pausedReason: 'manual' });
    expect((await run('2027-03-01', g.id)).created).toBe(0);
  });
});

describe('cron endpoint', () => {
  it('needs the bearer token', async () => {
    expect((await t.request('/api/cron/recurring')).status).toBe(401);
    expect((await t.request('/api/cron/recurring', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    const ok = await t.request('/api/cron/recurring', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ created: expect.any(Number), paused: expect.any(Number) });
  });
});
