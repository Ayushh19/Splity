import { describe, expect, it } from 'vitest';
import { canDisputeSettlement, canRecordSettlement, settlementInput, upiPayLink } from '../src';

const real = (id: string) => ({ id, isPlaceholder: false });
const placeholder = (id: string) => ({ id, isPlaceholder: true });

describe('canRecordSettlement', () => {
  it('lets either party record', () => {
    expect(canRecordSettlement('you', real('you'), real('arjun'))).toBe(true);
    expect(canRecordSettlement('arjun', real('you'), real('arjun'))).toBe(true);
  });
  it('blocks a third person between two real users', () => {
    expect(canRecordSettlement('meera', real('you'), real('arjun'))).toBe(false);
  });
  it('lets anyone record when a placeholder is involved', () => {
    expect(canRecordSettlement('meera', placeholder('rahul'), real('priya'))).toBe(true);
    expect(canRecordSettlement('meera', placeholder('rahul'), placeholder('kabir'))).toBe(true);
  });
});

describe('canDisputeSettlement', () => {
  const s = { fromMember: 'you', toMember: 'arjun', recordedBy: 'you' };
  it('only the other party can dispute', () => {
    expect(canDisputeSettlement('arjun', s)).toBe(true);
    expect(canDisputeSettlement('you', s)).toBe(false);
    expect(canDisputeSettlement('meera', s)).toBe(false);
  });
  it('when a third person recorded it, both parties can dispute', () => {
    const onBehalf = { fromMember: 'rahul', toMember: 'priya', recordedBy: 'meera' };
    expect(canDisputeSettlement('priya', onBehalf)).toBe(true);
    expect(canDisputeSettlement('meera', onBehalf)).toBe(false);
  });
});

describe('settlementInput', () => {
  it('rejects paying yourself', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(settlementInput.safeParse({ fromMember: id, toMember: id, amountMinor: 100, settledOn: '2026-10-01' }).success).toBe(false);
  });
});

describe('upiPayLink', () => {
  it('fills payee, amount in rupees and an encoded note', () => {
    expect(upiPayLink({ upiId: 'arjun@okaxis', payeeName: 'Arjun K', amountMinor: 50050, note: 'Splity: Flat 302' })).toBe(
      'upi://pay?pa=arjun%40okaxis&pn=Arjun%20K&am=500.50&cu=INR&tn=Splity%3A%20Flat%20302',
    );
  });
});
