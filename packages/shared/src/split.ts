import { assertMinor, MoneyError, type MemberId, type Minor } from './money';
import { sortByMember, type MemberOrder } from './order';

export type SplitInput =
  | { method: 'equal'; participants: readonly MemberId[] }
  | { method: 'exact'; amounts: readonly { memberId: MemberId; amountMinor: Minor }[] }
  | { method: 'shares'; shares: readonly { memberId: MemberId; shares: number }[] };

export interface Owed {
  memberId: MemberId;
  owedMinor: Minor;
}

export interface Payer {
  memberId: MemberId;
  paidMinor: Minor;
}

function assertTotal(totalMinor: Minor): void {
  assertMinor(totalMinor, 'total');
  if (totalMinor <= 0) throw new MoneyError('INVALID_AMOUNT', 'Total must be greater than zero');
}

function assertUnique(ids: readonly MemberId[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new MoneyError('INVALID_SPLIT', `The same member appears twice in ${what}`);
  }
}

/**
 * Split proportionally to integer weights: floor each share, then hand out the
 * leftover minor units one each in member order. `equal` is weights of 1.
 */
function splitByWeights(
  totalMinor: Minor,
  weights: readonly { memberId: MemberId; weight: number }[],
  order: MemberOrder,
): Owed[] {
  const sorted = sortByMember(order, weights, (w) => w.memberId);
  const totalWeight = sorted.reduce((sum, w) => sum + BigInt(w.weight), 0n);
  const total = BigInt(totalMinor);

  const owed = sorted.map((w) => ({
    memberId: w.memberId,
    owedMinor: Number((total * BigInt(w.weight)) / totalWeight),
  }));
  let leftover = totalMinor - owed.reduce((sum, o) => sum + o.owedMinor, 0);
  for (const o of owed) {
    if (leftover === 0) break;
    o.owedMinor += 1;
    leftover -= 1;
  }
  return owed;
}

/**
 * Compute what each participant owes. The result is in member order and always
 * sums to `totalMinor`; this is the value stored in `expense_splits.owed_minor`.
 */
export function computeSplit(totalMinor: Minor, input: SplitInput, order: MemberOrder): Owed[] {
  assertTotal(totalMinor);

  switch (input.method) {
    case 'equal': {
      if (input.participants.length === 0) {
        throw new MoneyError('INVALID_SPLIT', 'Pick at least one person to split with');
      }
      assertUnique(input.participants, 'the split');
      return splitByWeights(
        totalMinor,
        input.participants.map((memberId) => ({ memberId, weight: 1 })),
        order,
      );
    }

    case 'shares': {
      if (input.shares.length === 0) {
        throw new MoneyError('INVALID_SPLIT', 'Pick at least one person to split with');
      }
      assertUnique(
        input.shares.map((s) => s.memberId),
        'the split',
      );
      for (const s of input.shares) {
        if (!Number.isSafeInteger(s.shares) || s.shares < 1) {
          throw new MoneyError('INVALID_SPLIT', 'Shares must be whole numbers of at least 1');
        }
      }
      return splitByWeights(
        totalMinor,
        input.shares.map((s) => ({ memberId: s.memberId, weight: s.shares })),
        order,
      );
    }

    case 'exact': {
      if (input.amounts.length === 0) {
        throw new MoneyError('INVALID_SPLIT', 'Pick at least one person to split with');
      }
      assertUnique(
        input.amounts.map((a) => a.memberId),
        'the split',
      );
      let sum = 0;
      for (const a of input.amounts) {
        assertMinor(a.amountMinor);
        if (a.amountMinor < 0) throw new MoneyError('INVALID_SPLIT', 'Amounts cannot be negative');
        sum += a.amountMinor;
      }
      if (sum !== totalMinor) {
        throw new MoneyError('SUM_MISMATCH', `Split amounts add up to ${sum}, expected ${totalMinor}`);
      }
      return sortByMember(order, input.amounts, (a) => a.memberId).map((a) => ({
        memberId: a.memberId,
        owedMinor: a.amountMinor,
      }));
    }
  }
}

/** Check that payers are distinct, each paid something, and together paid exactly the total. */
export function validatePayers(totalMinor: Minor, payers: readonly Payer[], order: MemberOrder): Payer[] {
  assertTotal(totalMinor);
  if (payers.length === 0) throw new MoneyError('INVALID_SPLIT', 'Someone has to have paid');
  assertUnique(
    payers.map((p) => p.memberId),
    'the payers',
  );
  let sum = 0;
  for (const p of payers) {
    assertMinor(p.paidMinor);
    if (p.paidMinor <= 0) throw new MoneyError('INVALID_SPLIT', 'Each payer must have paid more than zero');
    sum += p.paidMinor;
  }
  if (sum !== totalMinor) {
    throw new MoneyError('SUM_MISMATCH', `Payers paid ${sum} in total, expected ${totalMinor}`);
  }
  return sortByMember(order, payers, (p) => p.memberId);
}
