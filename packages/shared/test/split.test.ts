import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSplit, memberOrder, MoneyError, validatePayers } from '../src';

// Join order: you, Priya, Arjun, Rahul.
const order = memberOrder([
  { id: 'you', sortKey: 1 },
  { id: 'priya', sortKey: 2 },
  { id: 'arjun', sortKey: 3 },
  { id: 'rahul', sortKey: 4 },
]);

describe('computeSplit — equal', () => {
  it('splits evenly when it divides', () => {
    expect(computeSplit(300000, { method: 'equal', participants: ['you', 'priya', 'arjun', 'rahul'] }, order)).toEqual([
      { memberId: 'you', owedMinor: 75000 },
      { memberId: 'priya', owedMinor: 75000 },
      { memberId: 'arjun', owedMinor: 75000 },
      { memberId: 'rahul', owedMinor: 75000 },
    ]);
  });

  it('gives leftover paise to members in join order (₹1,000 / 3 → 333.34, 333.33, 333.33)', () => {
    // Passed in a scrambled order on purpose: the result must not depend on it.
    expect(computeSplit(100000, { method: 'equal', participants: ['arjun', 'you', 'priya'] }, order)).toEqual([
      { memberId: 'you', owedMinor: 33334 },
      { memberId: 'priya', owedMinor: 33333 },
      { memberId: 'arjun', owedMinor: 33333 },
    ]);
  });

  it('rejects empty, duplicate and unknown participants', () => {
    expect(() => computeSplit(100, { method: 'equal', participants: [] }, order)).toThrow(MoneyError);
    expect(() => computeSplit(100, { method: 'equal', participants: ['you', 'you'] }, order)).toThrow(MoneyError);
    expect(() => computeSplit(100, { method: 'equal', participants: ['stranger'] }, order)).toThrow(/not in this group/);
  });

  it('rejects non-positive or fractional totals', () => {
    expect(() => computeSplit(0, { method: 'equal', participants: ['you'] }, order)).toThrow(MoneyError);
    expect(() => computeSplit(10.5, { method: 'equal', participants: ['you'] }, order)).toThrow(MoneyError);
  });
});

describe('computeSplit — shares', () => {
  it('weights the split (Arjun had 2 drinks)', () => {
    expect(
      computeSplit(
        100000,
        {
          method: 'shares',
          shares: [
            { memberId: 'you', shares: 1 },
            { memberId: 'priya', shares: 1 },
            { memberId: 'arjun', shares: 2 },
          ],
        },
        order,
      ),
    ).toEqual([
      { memberId: 'you', owedMinor: 25000 },
      { memberId: 'priya', owedMinor: 25000 },
      { memberId: 'arjun', owedMinor: 50000 },
    ]);
  });

  it('distributes leftovers in join order', () => {
    // 100 paise at 1:1:1 → 34, 33, 33
    expect(
      computeSplit(
        100,
        {
          method: 'shares',
          shares: [
            { memberId: 'arjun', shares: 1 },
            { memberId: 'priya', shares: 1 },
            { memberId: 'you', shares: 1 },
          ],
        },
        order,
      ).map((o) => o.owedMinor),
    ).toEqual([34, 33, 33]);
  });

  it('rejects zero or fractional shares', () => {
    expect(() =>
      computeSplit(100, { method: 'shares', shares: [{ memberId: 'you', shares: 0 }] }, order),
    ).toThrow(MoneyError);
    expect(() =>
      computeSplit(100, { method: 'shares', shares: [{ memberId: 'you', shares: 1.5 }] }, order),
    ).toThrow(MoneyError);
  });
});

describe('computeSplit — exact', () => {
  it('uses the amounts as given when they add up', () => {
    expect(
      computeSplit(
        300000,
        {
          method: 'exact',
          amounts: [
            { memberId: 'arjun', amountMinor: 80000 },
            { memberId: 'you', amountMinor: 100000 },
            { memberId: 'priya', amountMinor: 120000 },
          ],
        },
        order,
      ),
    ).toEqual([
      { memberId: 'you', owedMinor: 100000 },
      { memberId: 'priya', owedMinor: 120000 },
      { memberId: 'arjun', owedMinor: 80000 },
    ]);
  });

  it('rejects amounts that do not add up', () => {
    expect(() =>
      computeSplit(
        300000,
        {
          method: 'exact',
          amounts: [
            { memberId: 'you', amountMinor: 100000 },
            { memberId: 'priya', amountMinor: 100000 },
          ],
        },
        order,
      ),
    ).toThrow(expect.objectContaining({ code: 'SUM_MISMATCH' }));
  });
});

describe('validatePayers', () => {
  it('accepts multiple payers that sum to the total', () => {
    expect(
      validatePayers(
        300000,
        [
          { memberId: 'priya', paidMinor: 200000 },
          { memberId: 'you', paidMinor: 100000 },
        ],
        order,
      ).map((p) => p.memberId),
    ).toEqual(['you', 'priya']);
  });

  it('rejects mismatched sums, zero payments and duplicates', () => {
    expect(() => validatePayers(300000, [{ memberId: 'you', paidMinor: 200000 }], order)).toThrow(
      expect.objectContaining({ code: 'SUM_MISMATCH' }),
    );
    expect(() =>
      validatePayers(
        100,
        [
          { memberId: 'you', paidMinor: 100 },
          { memberId: 'priya', paidMinor: 0 },
        ],
        order,
      ),
    ).toThrow(MoneyError);
    expect(() =>
      validatePayers(
        100,
        [
          { memberId: 'you', paidMinor: 50 },
          { memberId: 'you', paidMinor: 50 },
        ],
        order,
      ),
    ).toThrow(MoneyError);
    expect(() => validatePayers(100, [], order)).toThrow(MoneyError);
  });
});

describe('computeSplit — properties', () => {
  const members = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, sortKey: i }));
  const bigOrder = memberOrder(members);
  const total = fc.integer({ min: 1, max: 100_000_000_00 });
  const subset = fc.uniqueArray(fc.integer({ min: 0, max: 49 }), { minLength: 1, maxLength: 50 });

  it('equal: sums to total, each share within 1 paisa of the others, extras go to earliest members', () => {
    fc.assert(
      fc.property(total, subset, (t, idx) => {
        const owed = computeSplit(t, { method: 'equal', participants: idx.map((i) => `m${i}`) }, bigOrder);
        const amounts = owed.map((o) => o.owedMinor);
        expect(amounts.reduce((a, b) => a + b, 0)).toBe(t);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
        // non-increasing in join order
        for (let i = 1; i < amounts.length; i++) expect(amounts[i]!).toBeLessThanOrEqual(amounts[i - 1]!);
      }),
    );
  });

  it('shares: sums to total and each share is at most 1 paisa from its exact proportion', () => {
    fc.assert(
      fc.property(
        total,
        fc.uniqueArray(fc.record({ i: fc.integer({ min: 0, max: 49 }), w: fc.integer({ min: 1, max: 100 }) }), {
          minLength: 1,
          maxLength: 50,
          selector: (x) => x.i,
        }),
        (t, ws) => {
          const owed = computeSplit(
            t,
            { method: 'shares', shares: ws.map((x) => ({ memberId: `m${x.i}`, shares: x.w })) },
            bigOrder,
          );
          expect(owed.reduce((a, o) => a + o.owedMinor, 0)).toBe(t);
          const totalWeight = ws.reduce((a, x) => a + x.w, 0);
          for (const o of owed) {
            const w = ws.find((x) => `m${x.i}` === o.memberId)!.w;
            // |owed − t·w/W| ≤ 1, in integers to avoid float error
            expect(Math.abs(o.owedMinor * totalWeight - t * w)).toBeLessThanOrEqual(totalWeight);
          }
        },
      ),
    );
  });

  it('is independent of input order', () => {
    fc.assert(
      fc.property(total, subset, (t, idx) => {
        const ids = idx.map((i) => `m${i}`);
        const a = computeSplit(t, { method: 'equal', participants: ids }, bigOrder);
        const b = computeSplit(t, { method: 'equal', participants: [...ids].reverse() }, bigOrder);
        expect(a).toEqual(b);
      }),
    );
  });
});
