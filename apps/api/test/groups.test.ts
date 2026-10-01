import type { GroupDetail, MemberView } from '@splity/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expensePayers, expenses, expenseSplits } from '../src/db/schema';
import { BASE_URL, testApp } from './helpers';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

type User = Awaited<ReturnType<typeof t.user>>;

async function createGroup(owner: User, placeholders: string[] = [], name = 'Flat 302'): Promise<GroupDetail> {
  const res = await owner.post('/groups', { name, currency: 'INR', placeholders });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as GroupDetail;
}

const tokenOf = (g: GroupDetail) => g.inviteUrl!.split('/join/')[1]!;
const byName = (g: GroupDetail, name: string) => g.members.find((m) => m.displayName === name) as MemberView;

/** `payer` paid `amount`, owed entirely by `debtor` → debtor owes payer `amount`. */
async function addDebt(g: GroupDetail, payer: MemberView, debtor: MemberView, amount = 50000) {
  await t.db.transaction(async (tx) => {
    const [e] = await tx
      .insert(expenses)
      .values({
        groupId: g.id,
        createdBy: payer.id,
        description: 'Groceries',
        expenseDate: '2026-10-01',
        amountMinor: amount,
        splitMethod: 'exact',
      })
      .returning();
    await tx.insert(expensePayers).values({ expenseId: e!.id, memberId: payer.id, paidMinor: amount });
    await tx.insert(expenseSplits).values({ expenseId: e!.id, memberId: debtor.id, owedMinor: amount, exactMinor: amount });
  });
}

describe('creating groups', () => {
  it('creates a group with the creator as admin and placeholders in order', async () => {
    const you = await t.user('Ayush');
    const g = await createGroup(you, ['Priya', 'Arjun']);
    expect(g.currency).toBe('INR');
    expect(g.simplifyDebts).toBe(true);
    expect(g.inviteUrl).toMatch(new RegExp(`^${BASE_URL}/join/[A-Za-z0-9_-]{22}$`));
    expect(g.members.map((m) => [m.displayName, m.role, m.isPlaceholder, m.isYou])).toEqual([
      ['Ayush', 'admin', false, true],
      ['Priya', 'member', true, false],
      ['Arjun', 'member', true, false],
    ]);
    expect(g.you.role).toBe('admin');
  });

  it('rejects duplicate names, including the creator’s own', async () => {
    const you = await t.user('Meera');
    for (const placeholders of [['Priya', 'priya'], ['MEERA']]) {
      const res = await you.post('/groups', { name: 'Trip', currency: 'INR', placeholders });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('duplicate_name');
    }
  });

  it('validates name and currency', async () => {
    const you = await t.user('Kabir');
    expect((await you.post('/groups', { name: ' ', currency: 'INR' })).status).toBe(400);
    expect((await you.post('/groups', { name: 'Trip', currency: 'XYZ' })).status).toBe(400);
  });

  it('lists my groups with my balance and member count', async () => {
    const you = await t.user('Lists');
    const g = await createGroup(you, ['Priya'], 'Goa Trip');
    const list = await you.get('/groups');
    expect(list.body).toEqual([
      { id: g.id, name: 'Goa Trip', currency: 'INR', archived: false, yourNetMinor: 0, memberCount: 2, youAreRemoved: false },
    ]);
  });

  it('hides groups from non-members (404, not 403)', async () => {
    const g = await createGroup(await t.user('Owner'));
    const stranger = await t.user('Stranger');
    expect((await stranger.get(`/groups/${g.id}`)).status).toBe(404);
    expect((await stranger.post(`/groups/${g.id}/members`, { displayName: 'X' })).status).toBe(404);
  });
});

describe('placeholders', () => {
  it('any member can add one; names must be unique', async () => {
    const you = await t.user('Adder');
    const g = await createGroup(you, ['Priya']);
    const added = await you.post(`/groups/${g.id}/members`, { displayName: 'Rahul' });
    expect(added.status).toBe(201);
    expect(byName(added.body, 'Rahul').isPlaceholder).toBe(true);
    const dup = await you.post(`/groups/${g.id}/members`, { displayName: 'priya' });
    expect(dup.body.error).toBe('duplicate_name');
  });

  it('caps a group at 50 active members', async () => {
    const you = await t.user('Big');
    const g = await createGroup(you, Array.from({ length: 49 }, (_, i) => `Friend ${i + 1}`));
    expect(g.members).toHaveLength(50);
    const res = await you.post(`/groups/${g.id}/members`, { displayName: 'One too many' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('group_full');
  });
});

describe('invite links', () => {
  it('previews signed out, then lets someone claim their placeholder', async () => {
    const you = await t.user('Inviter');
    const g = await createGroup(you, ['Rahul', 'Priya']);

    const preview = await t.request(`/api/invites/${tokenOf(g)}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      groupId: g.id,
      groupName: 'Flat 302',
      memberCount: 3,
      unclaimed: [{ displayName: 'Rahul' }, { displayName: 'Priya' }],
      alreadyMember: false,
    });

    const rahul = await t.user('Rahul K');
    const joined = await rahul.post(`/invites/${tokenOf(g)}/join`, { claimMemberId: byName(g, 'Rahul').id });
    expect(joined.status).toBe(201);
    const me = (joined.body as GroupDetail).members.find((m) => m.isYou)!;
    expect(me).toMatchObject({ id: byName(g, 'Rahul').id, displayName: 'Rahul K', isPlaceholder: false, claimed: true });

    // Claimed placeholders disappear from the preview, and can't be claimed twice.
    const after = await rahul.get(`/invites/${tokenOf(g)}`);
    expect(after.body.unclaimed.map((u: { displayName: string }) => u.displayName)).toEqual(['Priya']);
    expect(after.body.alreadyMember).toBe(true);
    const thief = await t.user('Thief');
    const again = await thief.post(`/invites/${tokenOf(g)}/join`, { claimMemberId: byName(g, 'Rahul').id });
    expect(again.body.error).toBe('already_claimed');

    // Already a member: can't join again.
    expect((await rahul.post(`/invites/${tokenOf(g)}/join`, {})).body.error).toBe('already_member');

    const activity = await you.get(`/groups/${g.id}/activity`);
    expect(activity.body[0]).toMatchObject({ type: 'member.claimed', actorName: 'Rahul K', payload: { placeholder: 'Rahul' } });
  });

  it('lets someone join as a new member', async () => {
    const you = await t.user('Host');
    const g = await createGroup(you);
    const late = await t.user('Latecomer');
    const res = await late.post(`/invites/${tokenOf(g)}/join`, {});
    expect(res.status).toBe(201);
    expect((res.body as GroupDetail).members.map((m) => m.displayName)).toEqual(['Host', 'Latecomer']);
    expect((await late.get('/groups')).body).toHaveLength(1);
  });

  it('requires sign-in to join', async () => {
    const g = await createGroup(await t.user('Gatekeeper'));
    const res = await t.request(`/api/invites/${tokenOf(g)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('resetting the link kills the old one (admin only)', async () => {
    const you = await t.user('Resetter');
    const g = await createGroup(you);
    const member = await t.user('Plain member');
    await member.post(`/invites/${tokenOf(g)}/join`, {});

    expect((await member.post(`/groups/${g.id}/invite/reset`)).status).toBe(403);
    const reset = await you.post(`/groups/${g.id}/invite/reset`);
    expect(tokenOf(reset.body)).not.toBe(tokenOf(g));
    expect((await t.request(`/api/invites/${tokenOf(g)}`)).status).toBe(404);
    expect((await t.request(`/api/invites/${tokenOf(reset.body)}`)).status).toBe(200);
  });

  it('admin can undo a wrong claim; the row becomes a placeholder again', async () => {
    const you = await t.user('Undoer');
    const g = await createGroup(you, ['Priya']);
    const wrong = await t.user('Not Priya');
    await wrong.post(`/invites/${tokenOf(g)}/join`, { claimMemberId: byName(g, 'Priya').id });

    const undone = await you.post(`/groups/${g.id}/members/${byName(g, 'Priya').id}/undo-claim`);
    expect(undone.status).toBe(200);
    expect(byName(undone.body, 'Priya')).toMatchObject({ isPlaceholder: true });
    expect((await wrong.get(`/groups/${g.id}`)).status).toBe(404);
  });
});

describe('group settings', () => {
  it('any member can rename and toggle simplify; both are logged in order', async () => {
    const you = await t.user('Settler');
    const g = await createGroup(you);
    const member = await t.user('Toggler');
    await member.post(`/invites/${tokenOf(g)}/join`, {});

    const res = await member.patch(`/groups/${g.id}`, { name: 'Flat 302 (2026)', simplifyDebts: false });
    expect(res.body).toMatchObject({ name: 'Flat 302 (2026)', simplifyDebts: false });

    const types = (await you.get(`/groups/${g.id}/activity`)).body.map((e: { type: string }) => e.type);
    expect(types).toEqual(['group.simplify_changed', 'group.renamed', 'member.joined', 'group.created']);
  });

  it('only admins can promote and remove', async () => {
    const you = await t.user('Boss');
    const g = await createGroup(you, ['Priya']);
    const member = await t.user('Worker');
    const joined = await member.post(`/invites/${tokenOf(g)}/join`, {});
    const workerId = (joined.body as GroupDetail).you.memberId;

    expect((await member.del(`/groups/${g.id}/members/${byName(g, 'Priya').id}`)).status).toBe(403);
    expect((await member.post(`/groups/${g.id}/members/${workerId}/promote`)).status).toBe(403);
    const promoted = await you.post(`/groups/${g.id}/members/${workerId}/promote`);
    expect(promoted.body.members.find((m: MemberView) => m.id === workerId).role).toBe('admin');
    // Placeholders can't be admins.
    expect((await you.post(`/groups/${g.id}/members/${byName(g, 'Priya').id}/promote`)).status).toBe(403);
  });
});

describe('removing and leaving', () => {
  it('deletes a placeholder with no history, but keeps one with history as removed', async () => {
    const you = await t.user('Remover');
    const g = await createGroup(you, ['Typo', 'Arjun']);
    const me = g.members.find((m) => m.isYou)!;
    await addDebt(g, me, byName(g, 'Arjun'));

    const afterTypo = await you.del(`/groups/${g.id}/members/${byName(g, 'Typo').id}`);
    expect(afterTypo.body.members.map((m: MemberView) => m.displayName)).toEqual(['Remover', 'Arjun']);

    const afterArjun = await you.del(`/groups/${g.id}/members/${byName(g, 'Arjun').id}`);
    expect(byName(afterArjun.body, 'Arjun')).toMatchObject({ status: 'removed', netMinor: -50000 });
    expect(afterArjun.body.members.find((m: MemberView) => m.isYou).netMinor).toBe(50000);
  });

  it('a removed member with a balance can still see the group but not change it', async () => {
    const you = await t.user('Admin R');
    const g = await createGroup(you);
    const friend = await t.user('Removed Friend');
    const joined = (await friend.post(`/invites/${tokenOf(g)}/join`, {})).body as GroupDetail;
    const friendView = joined.members.find((m) => m.isYou)!;
    await addDebt(g, g.members[0]!, friendView);

    await you.del(`/groups/${g.id}/members/${friendView.id}`);
    expect((await friend.get(`/groups/${g.id}`)).body.you.status).toBe('removed');
    expect((await friend.post(`/groups/${g.id}/members`, { displayName: 'X' })).status).toBe(403);
    expect((await friend.get('/groups')).body).toMatchObject([{ id: g.id, youAreRemoved: true, yourNetMinor: -50000 }]);

    // Rejoining through the link reactivates the same row, history intact.
    const back = await friend.post(`/invites/${tokenOf(g)}/join`, {});
    expect(back.body.you).toMatchObject({ memberId: friendView.id, status: 'active' });
  });

  it('blocks leaving with a non-zero balance', async () => {
    const you = await t.user('Debtor host');
    const g = await createGroup(you);
    const friend = await t.user('Creditor');
    const joined = (await friend.post(`/invites/${tokenOf(g)}/join`, {})).body as GroupDetail;
    await addDebt(g, joined.members.find((m) => m.isYou)!, g.members[0]!);

    const res = await you.post(`/groups/${g.id}/leave`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('nonzero_balance');
  });

  it('when the last admin leaves, the longest-standing real member becomes admin', async () => {
    const you = await t.user('Founder');
    const g = await createGroup(you, ['Placeholder']);
    const first = await t.user('First joiner');
    const second = await t.user('Second joiner');
    await first.post(`/invites/${tokenOf(g)}/join`, {});
    await second.post(`/invites/${tokenOf(g)}/join`, {});

    expect((await you.post(`/groups/${g.id}/leave`)).status).toBe(204);
    const view = (await first.get(`/groups/${g.id}`)).body as GroupDetail;
    expect(byName(view, 'First joiner').role).toBe('admin');
    expect(byName(view, 'Second joiner').role).toBe('member');
    expect(byName(view, 'Founder').status).toBe('removed');

    const [latest, previous] = (await first.get(`/groups/${g.id}/activity`)).body;
    expect(latest).toMatchObject({ type: 'admin.auto_promoted', payload: { name: 'First joiner' } });
    expect(previous).toMatchObject({ type: 'member.left', actorName: 'Founder' });
  });

  it("the last real member can't leave", async () => {
    const you = await t.user('Alone');
    const g = await createGroup(you, ['Imaginary friend']);
    const res = await you.post(`/groups/${g.id}/leave`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('last_member');
  });
});
