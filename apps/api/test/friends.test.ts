import type { FriendDetail, FriendSummary, GroupDetail, GroupSummary } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

type User = Awaited<ReturnType<typeof t.user>>;

async function groupWith(owner: User, others: User[], name: string, currency: string) {
  const created = (await owner.post('/groups', { name, currency, placeholders: ['Placeholder'] })).body as GroupDetail;
  const token = created.inviteUrl!.split('/join/')[1];
  for (const o of others) await o.post(`/invites/${token}/join`, {});
  const g = (await owner.get(`/groups/${created.id}`)).body as GroupDetail;
  const id = (n: string) => g.members.find((m) => m.displayName === n)!.id;
  return { g, id };
}

const paidSplitEqually = (payer: string, participants: string[], amountMinor: number) => ({
  description: 'Shared',
  expenseDate: '2026-10-01',
  amountMinor,
  payers: [{ memberId: payer, paidMinor: amountMinor }],
  split: { method: 'equal', participants },
});

/** Ayush and Priya share an INR flat (Priya owes ₹500) and a THB trip (Ayush owes ฿300). */
async function setup() {
  const ayush = await t.user('Ayush');
  const priya = await t.user('Priya');
  const stranger = await t.user('Stranger');
  const flat = await groupWith(ayush, [priya], 'Flat', 'INR');
  const trip = await groupWith(priya, [ayush], 'Trip', 'THB');
  await ayush.post(`/groups/${flat.g.id}/expenses`, paidSplitEqually(flat.id('Ayush'), [flat.id('Ayush'), flat.id('Priya')], 100000));
  await priya.post(`/groups/${trip.g.id}/expenses`, paidSplitEqually(trip.id('Priya'), [trip.id('Ayush'), trip.id('Priya')], 60000));
  const priyaId = (await priya.get('/me')).body.id as string;
  const ayushId = (await ayush.get('/me')).body.id as string;
  return { ayush, priya, stranger, flat, trip, priyaId, ayushId };
}

describe('friends', () => {
  it('lists people you share groups with, net per currency, never converted', async () => {
    const { ayush, priyaId } = await setup();
    const list = (await ayush.get('/friends')).body as FriendSummary[];
    expect(list).toHaveLength(1); // not the stranger, not placeholders
    expect(list[0]).toMatchObject({ userId: priyaId, displayName: 'Priya' });
    expect(list[0]!.balances).toEqual(
      expect.arrayContaining([
        { currency: 'INR', netMinor: 50000 },
        { currency: 'THB', netMinor: -30000 },
      ]),
    );
  });

  it('shows the per-group breakdown, and hides non-friends', async () => {
    const { ayush, stranger, flat, trip, priyaId } = await setup();
    const detail = (await ayush.get(`/friends/${priyaId}`)).body as FriendDetail;
    expect(detail.directGroupId).toBeNull();
    expect(detail.groups.map((g) => [g.name, g.currency, g.netMinor])).toEqual([
      ['Flat', 'INR', 50000],
      ['Trip', 'THB', -30000],
    ]);
    expect(detail.groups[0]).toMatchObject({ groupId: flat.g.id, theirMemberId: flat.id('Priya'), yourMemberId: flat.id('Ayush'), writable: true });
    expect(detail.groups[1]!.groupId).toBe(trip.g.id);
    expect((await stranger.get(`/friends/${priyaId}`)).status).toBe(404);
  });

  it('uses each group’s current view (simplified or not)', async () => {
    const ayush = await t.user('Ayush');
    const priya = await t.user('Priya');
    const arjun = await t.user('Arjun');
    const { g, id } = await groupWith(ayush, [priya, arjun], 'Chain', 'INR');
    // Raw: Ayush → Priya ₹500, Priya → Arjun ₹500. Simplified: Ayush → Arjun ₹500.
    await ayush.post(`/groups/${g.id}/expenses`, { ...paidSplitEqually(id('Priya'), [id('Ayush')], 50000) });
    await ayush.post(`/groups/${g.id}/expenses`, { ...paidSplitEqually(id('Arjun'), [id('Priya')], 50000) });
    const priyaId = (await priya.get('/me')).body.id;
    const arjunId = (await arjun.get('/me')).body.id;
    const net = async (friendId: string) => ((await ayush.get(`/friends/${friendId}`)).body as FriendDetail).balances;
    expect(await net(priyaId)).toEqual([]);
    expect(await net(arjunId)).toEqual([{ currency: 'INR', netMinor: -50000 }]);

    await ayush.patch(`/groups/${g.id}`, { simplifyDebts: false });
    expect(await net(priyaId)).toEqual([{ currency: 'INR', netMinor: -50000 }]);
    expect(await net(arjunId)).toEqual([]);
  });
});

describe('1-on-1 groups', () => {
  it('created once from either side, in the creator’s default currency, both admins, no invite', async () => {
    const { ayush, priya, priyaId, ayushId } = await setup();
    await ayush.patch('/me', { defaultCurrency: 'SGD' });
    const created = await ayush.post(`/friends/${priyaId}/direct`);
    expect(created.status).toBe(201);
    const d = created.body as GroupDetail;
    expect(d).toMatchObject({ isDirect: true, name: 'Priya', currency: 'SGD', inviteUrl: null });
    expect(d.members.map((m) => [m.displayName, m.role])).toEqual([
      ['Ayush', 'admin'],
      ['Priya', 'admin'],
    ]);

    const again = await ayush.post(`/friends/${priyaId}/direct`);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(d.id);
    const fromPriya = await priya.post(`/friends/${ayushId}/direct`);
    expect(fromPriya.body).toMatchObject({ id: d.id, name: 'Ayush' });
  });

  it('counts in Home totals and the friend view, but is flagged as direct', async () => {
    const { ayush, priya, priyaId } = await setup();
    const d = (await ayush.post(`/friends/${priyaId}/direct`)).body as GroupDetail;
    const me = d.members.find((m) => m.isYou)!.id;
    const her = d.members.find((m) => !m.isYou)!.id;
    await ayush.post(`/groups/${d.id}/expenses`, paidSplitEqually(me, [her], 20000));

    const summaries = (await ayush.get('/groups')).body as GroupSummary[];
    expect(summaries.find((s) => s.id === d.id)).toMatchObject({ isDirect: true, name: 'Priya', yourNetMinor: 20000 });
    const detail = (await ayush.get(`/friends/${priyaId}`)).body as FriendDetail;
    expect(detail.directGroupId).toBe(d.id);
    expect(detail.groups[0]).toMatchObject({ name: '1-on-1', isDirect: true, netMinor: 20000 });
    expect(detail.balances).toEqual(expect.arrayContaining([{ currency: 'INR', netMinor: 70000 }]));

    // Push from a 1-on-1 is titled with the person.
    await priya.post('/push/subscriptions', { endpoint: 'https://push.example/priya-direct', keys: { p256dh: 'k', auth: 'a' } });
    const start = t.pushes.length;
    await ayush.post(`/groups/${d.id}/expenses`, paidSplitEqually(me, [her], 1000));
    await t.notifier.idle();
    expect(t.pushes.slice(start)[0]!.payload.title).toBe('Ayush');
  });

  it('has no placeholders, invite link, leaving or archiving', async () => {
    const { ayush, priyaId } = await setup();
    const d = (await ayush.post(`/friends/${priyaId}/direct`)).body as GroupDetail;
    expect((await ayush.post(`/groups/${d.id}/members`, { displayName: 'Third' })).status).toBe(403);
    expect((await ayush.post(`/groups/${d.id}/invite/reset`)).status).toBe(403);
    expect((await ayush.post(`/groups/${d.id}/leave`)).status).toBe(403);
    expect((await ayush.post(`/groups/${d.id}/archive`)).status).toBe(403);
  });

  it('only with friends', async () => {
    const { ayush } = await setup();
    const stranger = await t.user('Unknown');
    const strangerId = (await stranger.get('/me')).body.id;
    expect((await ayush.post(`/friends/${strangerId}/direct`)).status).toBe(404);
  });
});
