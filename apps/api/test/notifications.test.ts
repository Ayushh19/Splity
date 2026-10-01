import type { GroupDetail, ReminderResult } from '@splity/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushSubscriptions } from '../src/db/schema';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

type User = Awaited<ReturnType<typeof t.user>>;
let n = 0;

/** Turn on push for a user on a fake device; returns the endpoint. */
async function device(user: User, label = user.name) {
  const endpoint = `https://push.example/${label.replace(/\W/g, '')}-${++n}`;
  const res = await user.post('/push/subscriptions', { endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });
  expect(res.status).toBe(204);
  return endpoint;
}

/** Ayush (admin), Priya, Arjun and Meera all real and with a device; Rahul a placeholder. */
async function setup() {
  const ayush = await t.user('Ayush');
  const created = (await ayush.post('/groups', { name: 'Goa Trip', currency: 'INR', placeholders: ['Rahul'] })).body as GroupDetail;
  const token = created.inviteUrl!.split('/join/')[1];
  const priya = await t.user('Priya');
  const arjun = await t.user('Arjun');
  const meera = await t.user('Meera');
  for (const u of [priya, arjun, meera]) await u.post(`/invites/${token}/join`, {});
  const g = (await ayush.get(`/groups/${created.id}`)).body as GroupDetail;
  const id = (name: string) => g.members.find((m) => m.displayName === name)!.id;
  const ids = { ayush: id('Ayush'), priya: id('Priya'), arjun: id('Arjun'), meera: id('Meera'), rahul: id('Rahul') };
  const endpoints = { ayush: await device(ayush), priya: await device(priya), arjun: await device(arjun), meera: await device(meera) };
  return { g, ayush, priya, arjun, meera, ids, endpoints };
}

/** Wait for in-flight pushes, then mark where the next step's pushes begin. */
async function mark() {
  await t.notifier.idle();
  return t.pushes.length;
}

/** Pushes since `start`, as endpoint → body. */
async function pushesSince(start: number) {
  await t.notifier.idle();
  return t.pushes.slice(start);
}

const dinner = (ids: Record<string, string>, participants: string[]) => ({
  description: 'Dinner',
  expenseDate: '2026-10-01',
  amountMinor: 300000,
  payers: [{ memberId: ids.ayush, paidMinor: 300000 }],
  split: { method: 'equal', participants },
});

describe('expense notifications', () => {
  it('go to the people in the expense with their share, not the actor or others', async () => {
    const { g, ayush, ids, endpoints } = await setup();
    const start = await mark();
    await ayush.post(`/groups/${g.id}/expenses`, dinner(ids, [ids.ayush, ids.priya, ids.arjun]));
    const sent = await pushesSince(start);
    expect(sent.map((p) => p.endpoint).sort()).toEqual([endpoints.arjun, endpoints.priya].sort());
    const toPriya = sent.find((p) => p.endpoint === endpoints.priya)!.payload;
    expect(toPriya).toMatchObject({
      title: 'Goa Trip',
      body: 'Ayush added "Dinner" (₹3,000.00). You owe ₹1,000.00.',
      tag: expect.stringMatching(/^expense-/),
    });
    expect(toPriya.url).toMatch(new RegExp(`^/groups/${g.id}/expenses/`));
  });

  it('someone taken off an expense is told', async () => {
    const { g, ayush, ids, endpoints } = await setup();
    const e = (await ayush.post(`/groups/${g.id}/expenses`, dinner(ids, [ids.ayush, ids.priya, ids.arjun]))).body;
    const start = await mark();
    await ayush.put(`/groups/${g.id}/expenses/${e.id}`, { ...dinner(ids, [ids.ayush, ids.priya]), version: 1 });
    const toArjun = (await pushesSince(start)).find((p) => p.endpoint === endpoints.arjun)!.payload;
    expect(toArjun.body).toBe('Ayush edited "Dinner" (₹3,000.00). You\'re no longer in it.');
  });

  it('muted members get nothing', async () => {
    const { g, ayush, priya, ids, endpoints } = await setup();
    const muted = await priya.put(`/groups/${g.id}/mute`, { muted: true });
    expect((muted.body as GroupDetail).you.muted).toBe(true);
    const start = await mark();
    await ayush.post(`/groups/${g.id}/expenses`, dinner(ids, [ids.ayush, ids.priya, ids.arjun]));
    expect((await pushesSince(start)).map((p) => p.endpoint)).toEqual([endpoints.arjun]);
  });

  it('member events stay in the feed only', async () => {
    const { g, ayush } = await setup();
    const start = await mark();
    await ayush.post(`/groups/${g.id}/members`, { displayName: 'Kabir' });
    await ayush.patch(`/groups/${g.id}`, { simplifyDebts: false });
    expect(await pushesSince(start)).toEqual([]);
  });

  it('expired subscriptions are removed', async () => {
    const { g, ayush, arjun, ids } = await setup();
    const dead = await device(arjun, 'gone');
    await ayush.post(`/groups/${g.id}/expenses`, dinner(ids, [ids.ayush, ids.arjun]));
    await t.notifier.idle();
    expect(await t.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, dead))).toEqual([]);
  });
});

describe('payment notifications', () => {
  it('the other party hears about a payment, and the recorder about a dispute', async () => {
    const { g, ayush, arjun, ids, endpoints } = await setup();
    await arjun.post(`/groups/${g.id}/expenses`, {
      ...dinner(ids, [ids.ayush, ids.arjun]),
      payers: [{ memberId: ids.arjun, paidMinor: 300000 }],
    });
    let start = await mark();
    const s = (await ayush.post(`/groups/${g.id}/settlements`, { fromMember: ids.ayush, toMember: ids.arjun, amountMinor: 150000, settledOn: '2026-10-01', method: 'upi' })).body;
    expect((await pushesSince(start)).map((p) => [p.endpoint, p.payload.body])).toEqual([
      [endpoints.arjun, 'Ayush recorded a payment: Ayush paid you ₹1,500.00'],
    ]);

    start = await mark();
    await arjun.post(`/groups/${g.id}/settlements/${s.id}/dispute`, { version: 1, note: 'Not received yet' });
    expect((await pushesSince(start)).map((p) => [p.endpoint, p.payload.body])).toEqual([
      [endpoints.ayush, 'Arjun disputed a payment: you paid Arjun ₹1,500.00 — "Not received yet"'],
    ]);
  });
});

describe('reminders', () => {
  async function owes() {
    const f = await setup();
    // Priya owes Ayush ₹1,500.
    await f.ayush.post(`/groups/${f.g.id}/expenses`, dinner(f.ids, [f.ids.ayush, f.ids.priya]));
    return f;
  }

  it('reaches the debtor once per 24 hours, even if they muted the group', async () => {
    const { g, ayush, priya, ids, endpoints } = await owes();
    await priya.put(`/groups/${g.id}/mute`, { muted: true });
    const start = await mark();
    const res = await ayush.post(`/groups/${g.id}/reminders`, { toMember: ids.priya });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as ReminderResult).delivered).toBe(true);
    expect((await pushesSince(start)).map((p) => [p.endpoint, p.payload.body])).toEqual([
      [endpoints.priya, 'Ayush reminds you: you owe them ₹1,500.00.'],
    ]);

    const again = await ayush.post(`/groups/${g.id}/reminders`, { toMember: ids.priya });
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ error: 'rate_limited', retryAt: expect.any(String) });
    expect((await ayush.get(`/groups/${g.id}/reminders`)).body).toEqual([{ toMember: ids.priya, sentAt: expect.any(String) }]);
  });

  it("only people who owe you, with an account, and devices; otherwise it isn't recorded", async () => {
    const { g, ayush, priya, ids } = await owes();
    expect((await ayush.post(`/groups/${g.id}/reminders`, { toMember: ids.arjun })).status).toBe(400);
    expect((await ayush.post(`/groups/${g.id}/reminders`, { toMember: ids.rahul })).status).toBe(400);
    expect((await priya.post(`/groups/${g.id}/reminders`, { toMember: ids.ayush })).status).toBe(400);

    await t.db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, (await priya.get('/me')).body.id));
    const res = await ayush.post(`/groups/${g.id}/reminders`, { toMember: ids.priya });
    expect(res.body).toEqual({ delivered: false, reminder: null });
    expect((await ayush.get(`/groups/${g.id}/reminders`)).body).toEqual([]);
  });
});

describe('subscriptions', () => {
  it('a device moves to whoever signed in on it last, and can be removed', async () => {
    const a = await t.user('Device A');
    const b = await t.user('Device B');
    const endpoint = await device(a, 'shared');
    await b.post('/push/subscriptions', { endpoint, keys: { p256dh: 'x', auth: 'y' } });
    const [row] = await t.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row!.userId).toBe((await b.get('/me')).body.id);
    await b.post('/push/subscriptions/remove', { endpoint });
    expect(await t.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).toEqual([]);
  });

  it('config advertises push with the public key', async () => {
    expect(await (await t.request('/api/config')).json()).toEqual({ google: false, push: true, vapidPublicKey: 'test-vapid-public-key' });
  });
});
