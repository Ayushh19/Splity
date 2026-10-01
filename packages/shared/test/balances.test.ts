import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  computeSplit,
  expenseTransfers,
  memberOrder,
  netBalances,
  rawDebts,
  simplifyDebts,
  type LedgerExpense,
  type LedgerSettlement,
  type MemberId,
  type Transfer,
} from '../src';

const order = memberOrder([
  { id: 'you', sortKey: 1 },
  { id: 'priya', sortKey: 2 },
  { id: 'arjun', sortKey: 3 },
  { id: 'rahul', sortKey: 4 },
]);

const equal = (total: number, payers: LedgerExpense['payers'], participants: MemberId[]): LedgerExpense => ({
  payers,
  splits: computeSplit(total, { method: 'equal', participants }, order),
});

/** Applying transfers as payments must bring every net balance to zero. */
function settlesEverything(net: ReadonlyMap<MemberId, number>, transfers: Transfer[]): boolean {
  const after = new Map(net);
  for (const t of transfers) {
    after.set(t.from, (after.get(t.from) ?? 0) + t.amountMinor);
    after.set(t.to, (after.get(t.to) ?? 0) - t.amountMinor);
  }
  return [...after.values()].every((v) => v === 0);
}

describe('expenseTransfers (raw, per expense)', () => {
  it('spec example: ₹3,000 dinner, equal 3-way, Priya paid ₹2,000 and Arjun ₹1,000 → you → Priya ₹1,000', () => {
    const dinner = equal(
      300000,
      [
        { memberId: 'priya', paidMinor: 200000 },
        { memberId: 'arjun', paidMinor: 100000 },
      ],
      ['you', 'priya', 'arjun'],
    );
    expect(expenseTransfers(dinner, order)).toEqual([{ from: 'you', to: 'priya', amountMinor: 100000 }]);
  });

  it('single payer: everyone else owes the payer their share', () => {
    const lunch = equal(90000, [{ memberId: 'you', paidMinor: 90000 }], ['you', 'priya', 'arjun']);
    expect(expenseTransfers(lunch, order)).toEqual([
      { from: 'priya', to: 'you', amountMinor: 30000 },
      { from: 'arjun', to: 'you', amountMinor: 30000 },
    ]);
  });

  it('payer not part of the split is owed everything', () => {
    const gift = equal(100000, [{ memberId: 'rahul', paidMinor: 100000 }], ['you', 'priya']);
    expect(expenseTransfers(gift, order)).toEqual([
      { from: 'you', to: 'rahul', amountMinor: 50000 },
      { from: 'priya', to: 'rahul', amountMinor: 50000 },
    ]);
  });
});

describe('netBalances', () => {
  it('counts payments, shares and settlements', () => {
    const lunch = equal(90000, [{ memberId: 'you', paidMinor: 90000 }], ['you', 'priya', 'arjun']);
    const settlement: LedgerSettlement = { from: 'priya', to: 'you', amountMinor: 30000 };
    const net = netBalances([lunch], [settlement]);
    expect(Object.fromEntries(net)).toEqual({ you: 30000, priya: 0, arjun: -30000 });
  });
});

describe('rawDebts', () => {
  it('nets debts between the same pair across expenses', () => {
    const a = equal(100000, [{ memberId: 'you', paidMinor: 100000 }], ['you', 'priya']); // priya owes you 500
    const b = equal(60000, [{ memberId: 'priya', paidMinor: 60000 }], ['you', 'priya']); // you owe priya 300
    expect(rawDebts([a, b], [], order)).toEqual([{ from: 'priya', to: 'you', amountMinor: 20000 }]);
  });

  it('settlements reduce the pair debt, and overpaying flips it', () => {
    const a = equal(100000, [{ memberId: 'you', paidMinor: 100000 }], ['you', 'priya']); // priya owes you 500
    expect(rawDebts([a], [{ from: 'priya', to: 'you', amountMinor: 20000 }], order)).toEqual([
      { from: 'priya', to: 'you', amountMinor: 30000 },
    ]);
    expect(rawDebts([a], [{ from: 'priya', to: 'you', amountMinor: 50000 }], order)).toEqual([]);
    expect(rawDebts([a], [{ from: 'priya', to: 'you', amountMinor: 70000 }], order)).toEqual([
      { from: 'you', to: 'priya', amountMinor: 20000 },
    ]);
  });

  it('keeps chains that simplification would collapse', () => {
    const a = equal(100000, [{ memberId: 'priya', paidMinor: 100000 }], ['you', 'priya']); // you owe priya 500
    const b = equal(100000, [{ memberId: 'arjun', paidMinor: 100000 }], ['priya', 'arjun']); // priya owes arjun 500
    expect(rawDebts([a, b], [], order)).toEqual([
      { from: 'you', to: 'priya', amountMinor: 50000 },
      { from: 'priya', to: 'arjun', amountMinor: 50000 },
    ]);
  });
});

describe('simplifyDebts', () => {
  it('spec example: you → Priya ₹500 and Priya → Arjun ₹500 become you → Arjun ₹500', () => {
    const a = equal(100000, [{ memberId: 'priya', paidMinor: 100000 }], ['you', 'priya']);
    const b = equal(100000, [{ memberId: 'arjun', paidMinor: 100000 }], ['priya', 'arjun']);
    expect(simplifyDebts(netBalances([a, b], []), order)).toEqual([{ from: 'you', to: 'arjun', amountMinor: 50000 }]);
  });

  it('returns nothing when everyone is settled', () => {
    expect(simplifyDebts(new Map([['you', 0], ['priya', 0]]), order)).toEqual([]);
  });

  it('breaks ties by join order', () => {
    // you and priya each owe 100; arjun and rahul each owed 100
    const net = new Map([
      ['rahul', 100],
      ['priya', -100],
      ['arjun', 100],
      ['you', -100],
    ]);
    expect(simplifyDebts(net, order)).toEqual([
      { from: 'you', to: 'arjun', amountMinor: 100 },
      { from: 'priya', to: 'rahul', amountMinor: 100 },
    ]);
  });

  it('rejects balances that do not sum to zero', () => {
    expect(() => simplifyDebts(new Map([['you', -100]]), order)).toThrow(/do not add up/);
  });
});

describe('balances — properties', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
  const bigOrder = memberOrder(ids.map((id, i) => ({ id, sortKey: i })));

  const memberIdx = fc.integer({ min: 0, max: ids.length - 1 });
  const arbExpense = fc
    .record({
      total: fc.integer({ min: 1, max: 1_000_000 }),
      participants: fc.uniqueArray(memberIdx, { minLength: 1, maxLength: ids.length }),
      payerIdx: fc.uniqueArray(memberIdx, { minLength: 1, maxLength: 3 }),
    })
    .map(({ total, participants, payerIdx }): LedgerExpense => {
      // Split the total among payers deterministically (equal split reuses the same rules).
      const paid = computeSplit(total, { method: 'equal', participants: payerIdx.map((i) => ids[i]!) }, bigOrder);
      return {
        payers: paid.map((p) => ({ memberId: p.memberId, paidMinor: p.owedMinor })).filter((p) => p.paidMinor > 0),
        splits: computeSplit(total, { method: 'equal', participants: participants.map((i) => ids[i]!) }, bigOrder),
      };
    });
  const arbSettlement = fc
    .record({ from: memberIdx, to: memberIdx, amount: fc.integer({ min: 1, max: 500_000 }) })
    .filter((s) => s.from !== s.to)
    .map((s): LedgerSettlement => ({ from: ids[s.from]!, to: ids[s.to]!, amountMinor: s.amount }));

  const ledger = fc.tuple(fc.array(arbExpense, { maxLength: 30 }), fc.array(arbSettlement, { maxLength: 10 }));

  it('net balances always sum to zero', () => {
    fc.assert(
      fc.property(ledger, ([expenses, settlements]) => {
        const net = netBalances(expenses, settlements);
        expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
      }),
    );
  });

  it('per-expense transfers settle that expense exactly', () => {
    fc.assert(
      fc.property(arbExpense, (expense) => {
        const transfers = expenseTransfers(expense, bigOrder);
        expect(settlesEverything(netBalances([expense], []), transfers)).toBe(true);
        expect(transfers.every((t) => t.amountMinor > 0 && t.from !== t.to)).toBe(true);
      }),
    );
  });

  it('raw debts and simplified debts both settle every balance', () => {
    fc.assert(
      fc.property(ledger, ([expenses, settlements]) => {
        const net = netBalances(expenses, settlements);
        const raw = rawDebts(expenses, settlements, bigOrder);
        const simplified = simplifyDebts(net, bigOrder);
        expect(settlesEverything(net, raw)).toBe(true);
        expect(settlesEverything(net, simplified)).toBe(true);
      }),
    );
  });

  it('simplified debts need at most n−1 payments for n members with a balance', () => {
    fc.assert(
      fc.property(ledger, ([expenses, settlements]) => {
        const net = netBalances(expenses, settlements);
        const nonZero = [...net.values()].filter((v) => v !== 0).length;
        expect(simplifyDebts(net, bigOrder).length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      }),
    );
  });

  it('a pair never appears in both directions in raw debts', () => {
    fc.assert(
      fc.property(ledger, ([expenses, settlements]) => {
        const raw = rawDebts(expenses, settlements, bigOrder);
        const pairs = raw.map((t) => [t.from, t.to].sort().join('|'));
        expect(new Set(pairs).size).toBe(pairs.length);
      }),
    );
  });
});
