import type { ExpenseDetail, ExpenseInput, ExpenseView, GroupBalances, GroupDetail, MemberView } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

type User = Awaited<ReturnType<typeof t.user>>;

/** You (admin) + Priya + Arjun as placeholders, in that join order. */
async function flat(name = 'You') {
  const you = await t.user(name);
  const res = await you.post('/groups', { name: 'Flat 302', currency: 'INR', placeholders: ['Priya', 'Arjun'] });
  const g = res.body as GroupDetail;
  const [me, priya, arjun] = g.members as [MemberView, MemberView, MemberView];
  return { you, g, me, priya, arjun };
}

const base = (over: Partial<ExpenseInput>): ExpenseInput => ({
  description: 'Dinner',
  expenseDate: '2026-10-01',
  amountMinor: 300000,
  payers: [],
  split: { method: 'equal', participants: [] },
  ...over,
});

async function add(user: User, groupId: string, input: ExpenseInput) {
  return user.post(`/groups/${groupId}/expenses`, input);
}

describe('adding expenses', () => {
  it('equal split hands leftover paise out in join order (₹1,000 / 3)', async () => {
    const { you, g, me, priya, arjun } = await flat();
    const res = await add(
      you,
      g.id,
      base({
        amountMinor: 100000,
        payers: [{ memberId: me.id, paidMinor: 100000 }],
        split: { method: 'equal', participants: [arjun.id, priya.id, me.id] },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const e = res.body as ExpenseView;
    expect(e.splits.map((s) => [s.memberId, s.owedMinor])).toEqual([
      [me.id, 33334],
      [priya.id, 33333],
      [arjun.id, 33333],
    ]);
    expect(e.version).toBe(1);

    const balances = (await you.get(`/groups/${g.id}/balances`)).body as GroupBalances;
    expect(balances.net).toEqual([
      { memberId: me.id, netMinor: 66666 },
      { memberId: priya.id, netMinor: -33333 },
      { memberId: arjun.id, netMinor: -33333 },
    ]);
    // Group detail and Home use the same numbers.
    expect((await you.get('/groups')).body[0].yourNetMinor).toBe(66666);
  });

  it('multiple payers: Priya ₹2,000 + Arjun ₹1,000 of a ₹3,000 dinner → you owe Priya ₹1,000', async () => {
    const { you, g, me, priya, arjun } = await flat();
    await add(
      you,
      g.id,
      base({
        payers: [
          { memberId: priya.id, paidMinor: 200000 },
          { memberId: arjun.id, paidMinor: 100000 },
        ],
        split: { method: 'equal', participants: [me.id, priya.id, arjun.id] },
      }),
    );
    const b = (await you.get(`/groups/${g.id}/balances`)).body as GroupBalances;
    expect(b.raw).toEqual([{ from: me.id, to: priya.id, amountMinor: 100000 }]);
    expect(b.simplified).toEqual([{ from: me.id, to: priya.id, amountMinor: 100000 }]);
  });

  it('simplifies a chain: you → Priya ₹500 and Priya → Arjun ₹500 become you → Arjun ₹500', async () => {
    const { you, g, me, priya, arjun } = await flat();
    await add(you, g.id, base({ amountMinor: 50000, payers: [{ memberId: priya.id, paidMinor: 50000 }], split: { method: 'exact', amounts: [{ memberId: me.id, amountMinor: 50000 }] } }));
    await add(you, g.id, base({ amountMinor: 50000, payers: [{ memberId: arjun.id, paidMinor: 50000 }], split: { method: 'exact', amounts: [{ memberId: priya.id, amountMinor: 50000 }] } }));
    const b = (await you.get(`/groups/${g.id}/balances`)).body as GroupBalances;
    expect(b.raw).toEqual([
      { from: me.id, to: priya.id, amountMinor: 50000 },
      { from: priya.id, to: arjun.id, amountMinor: 50000 },
    ]);
    expect(b.simplified).toEqual([{ from: me.id, to: arjun.id, amountMinor: 50000 }]);
  });

  it('stores split inputs for shares and exact', async () => {
    const { you, g, me, priya, arjun } = await flat();
    const shares = (
      await add(
        you,
        g.id,
        base({
          amountMinor: 100000,
          payers: [{ memberId: me.id, paidMinor: 100000 }],
          split: { method: 'shares', shares: [{ memberId: me.id, shares: 1 }, { memberId: priya.id, shares: 1 }, { memberId: arjun.id, shares: 2 }] },
        }),
      )
    ).body as ExpenseView;
    expect(shares.splits.map((s) => [s.owedMinor, s.shares])).toEqual([[25000, 1], [25000, 1], [50000, 2]]);

    const exact = (
      await add(
        you,
        g.id,
        base({
          payers: [{ memberId: me.id, paidMinor: 300000 }],
          split: { method: 'exact', amounts: [{ memberId: me.id, amountMinor: 120000 }, { memberId: priya.id, amountMinor: 100000 }, { memberId: arjun.id, amountMinor: 80000 }] },
        }),
      )
    ).body as ExpenseView;
    expect(exact.splits.map((s) => [s.owedMinor, s.exactMinor])).toEqual([[120000, 120000], [100000, 100000], [80000, 80000]]);
  });

  it('converts a foreign amount with the manual rate (฿2,000 at 2.35 → ₹4,700)', async () => {
    const { you, g, me, priya } = await flat();
    const res = await add(
      you,
      g.id,
      base({
        amountMinor: 470000,
        foreign: { currency: 'THB', amountMinor: 200000, rate: '2.35' },
        payers: [{ memberId: me.id, paidMinor: 470000 }],
        split: { method: 'equal', participants: [me.id, priya.id] },
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ amountMinor: 470000, originalCurrency: 'THB', originalAmountMinor: 200000, fxRate: '2.35' });
  });

  it('rejects invalid expenses', async () => {
    const { you, g, me, priya } = await flat();
    const other = await flat('Elsewhere');
    const cases: [string, ExpenseInput][] = [
      ['payers short', base({ payers: [{ memberId: me.id, paidMinor: 200000 }], split: { method: 'equal', participants: [me.id] } })],
      ['exact short', base({ payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'exact', amounts: [{ memberId: me.id, amountMinor: 100 }] } })],
      ['outsider', base({ payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [other.me.id] } })],
      ['far future', base({ expenseDate: '2099-01-01', payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id] } })],
      ['same-currency fx', base({ foreign: { currency: 'INR', amountMinor: 300000, rate: '1' }, payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id] } })],
      ['too large', base({ amountMinor: 100_000_000_001, payers: [{ memberId: me.id, paidMinor: 100_000_000_001 }], split: { method: 'equal', participants: [me.id, priya.id] } })],
      ['no description', base({ description: ' ', payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id] } })],
    ];
    for (const [label, input] of cases) {
      const res = await add(you, g.id, input);
      expect(res.status, label).toBe(400);
    }
    expect((await you.get(`/groups/${g.id}/expenses`)).body).toEqual([]);
  });
});

describe('editing, deleting, restoring', () => {
  async function seeded() {
    const f = await flat();
    const created = (
      await add(f.you, f.g.id, base({ payers: [{ memberId: f.me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [f.me.id, f.priya.id, f.arjun.id] } }))
    ).body as ExpenseView;
    const edit = (version: number, amountMinor: number) =>
      f.you.put(`/groups/${f.g.id}/expenses/${created.id}`, {
        ...base({ amountMinor, payers: [{ memberId: f.me.id, paidMinor: amountMinor }], split: { method: 'equal', participants: [f.me.id, f.priya.id, f.arjun.id] } }),
        version,
      });
    return { ...f, created, edit };
  }

  it('edits bump the version and keep a full history', async () => {
    const { you, g, created, edit } = await seeded();
    const res = await edit(1, 240000);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amountMinor: 240000, version: 2 });

    const detail = (await you.get(`/groups/${g.id}/expenses/${created.id}`)).body as ExpenseDetail;
    expect(detail.history.map((h) => [h.version, h.action, h.actorName, h.snapshot.amountMinor])).toEqual([
      [1, 'create', 'You', 300000],
      [2, 'update', 'You', 240000],
    ]);
    const activity = (await you.get(`/groups/${g.id}/activity`)).body;
    expect(activity[0]).toMatchObject({ type: 'expense.updated', payload: { description: 'Dinner', amountMinor: 240000, currency: 'INR' } });
  });

  it('rejects a save based on a stale version with the current state', async () => {
    const { edit } = await seeded();
    await edit(1, 240000);
    const stale = await edit(1, 999900);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'conflict', changedBy: 'You', current: { amountMinor: 240000, version: 2 } });
  });

  it('delete removes it from balances; restore brings it back', async () => {
    const { you, g, created } = await seeded();
    const del = await you.post(`/groups/${g.id}/expenses/${created.id}/delete`, { version: 1 });
    expect(del.body).toMatchObject({ deleted: true, version: 2 });
    expect((await you.get(`/groups/${g.id}/expenses`)).body).toEqual([]);
    expect((await you.get(`/groups/${g.id}/expenses?deleted=1`)).body).toHaveLength(1);
    expect(((await you.get(`/groups/${g.id}/balances`)).body as GroupBalances).simplified).toEqual([]);

    // Stale delete/restore and editing a deleted expense are conflicts.
    expect((await you.post(`/groups/${g.id}/expenses/${created.id}/restore`, { version: 1 })).status).toBe(409);
    const restored = await you.post(`/groups/${g.id}/expenses/${created.id}/restore`, { version: 2 });
    expect(restored.body).toMatchObject({ deleted: false, version: 3 });
    expect((await you.get(`/groups/${g.id}/balances`)).body.simplified).toHaveLength(2);
  });
});

describe('membership rules for expenses', () => {
  it('removed members stay in old expenses but cannot be added to new ones', async () => {
    const { you, g, me, priya, arjun } = await flat();
    const e = (await add(you, g.id, base({ payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id, priya.id, arjun.id] } }))).body as ExpenseView;
    await you.del(`/groups/${g.id}/members/${arjun.id}`);

    const fresh = await add(you, g.id, base({ payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id, arjun.id] } }));
    expect(fresh.status).toBe(400);

    const edited = await you.put(`/groups/${g.id}/expenses/${e.id}`, {
      ...base({ description: 'Dinner (fixed)', payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id, priya.id, arjun.id] } }),
      version: 1,
    });
    expect(edited.status).toBe(200);
  });

  it('non-members get 404 and removed members cannot add', async () => {
    const { you, g, me } = await flat();
    const stranger = await t.user('Nosy');
    expect((await stranger.get(`/groups/${g.id}/expenses`)).status).toBe(404);
    expect((await stranger.get(`/groups/${g.id}/balances`)).status).toBe(404);

    const friend = await t.user('Soon removed');
    const joined = (await friend.post(`/invites/${g.inviteUrl!.split('/join/')[1]}/join`, {})).body as GroupDetail;
    await you.del(`/groups/${g.id}/members/${joined.you.memberId}`);
    const res = await add(friend, g.id, base({ payers: [{ memberId: me.id, paidMinor: 300000 }], split: { method: 'equal', participants: [me.id] } }));
    expect(res.status).toBe(403);
    expect((await friend.get(`/groups/${g.id}/expenses`)).status).toBe(200);
  });
});
