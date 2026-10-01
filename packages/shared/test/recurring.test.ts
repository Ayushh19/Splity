import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { anchorFor, isoWeekday, nextOccurrence, occurrenceOnOrAfter, scheduleText, todayIn } from '../src';

describe('anchors', () => {
  it('comes from the first date', () => {
    expect(anchorFor('monthly', '2026-10-31')).toBe(31);
    expect(isoWeekday('2026-10-01')).toBe(4); // Thursday
    expect(anchorFor('weekly', '2026-10-04')).toBe(7); // Sunday
  });
});

describe('nextOccurrence', () => {
  it('monthly: same day next month', () => {
    expect(nextOccurrence('monthly', 1, '2026-10-01')).toBe('2026-11-01');
    expect(nextOccurrence('monthly', 15, '2026-10-01')).toBe('2026-10-15');
    expect(nextOccurrence('monthly', 1, '2026-12-01')).toBe('2027-01-01');
  });

  it('monthly: day 29–31 falls back to the last day of short months, then returns to the anchor', () => {
    expect(nextOccurrence('monthly', 31, '2027-01-31')).toBe('2027-02-28');
    expect(nextOccurrence('monthly', 31, '2027-02-28')).toBe('2027-03-31');
    expect(nextOccurrence('monthly', 30, '2028-01-30')).toBe('2028-02-29'); // leap year
    expect(nextOccurrence('monthly', 31, '2026-04-29')).toBe('2026-04-30');
  });

  it('weekly: same weekday next week', () => {
    expect(nextOccurrence('weekly', 4, '2026-10-01')).toBe('2026-10-08'); // Thu → Thu
    expect(nextOccurrence('weekly', 1, '2026-10-01')).toBe('2026-10-05'); // Thu → Mon
    expect(nextOccurrence('weekly', 7, '2026-12-28')).toBe('2027-01-03'); // across the year
  });

  it('is always strictly later and lands on the anchor', () => {
    const date = fc
      .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2035-12-31T00:00:00Z'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(date, fc.integer({ min: 1, max: 31 }), (after, anchor) => {
        const next = nextOccurrence('monthly', anchor, after);
        expect(next > after).toBe(true);
        const [y, m, d] = next.split('-').map(Number) as [number, number, number];
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        expect(d).toBe(Math.min(anchor, last));
      }),
    );
    fc.assert(
      fc.property(date, fc.integer({ min: 1, max: 7 }), (after, anchor) => {
        const next = nextOccurrence('weekly', anchor, after);
        expect(next > after).toBe(true);
        expect(isoWeekday(next)).toBe(anchor);
        expect((Date.parse(next) - Date.parse(after)) / 86_400_000).toBeLessThanOrEqual(7);
      }),
    );
  });
});

describe('occurrenceOnOrAfter (resume)', () => {
  it('includes the day itself, otherwise the next date', () => {
    expect(occurrenceOnOrAfter('monthly', 1, '2026-11-01')).toBe('2026-11-01');
    expect(occurrenceOnOrAfter('monthly', 1, '2026-11-02')).toBe('2026-12-01');
  });
});

describe('scheduleText', () => {
  it('reads naturally', () => {
    expect(scheduleText('weekly', 1)).toBe('Every Monday');
    expect(scheduleText('monthly', 1)).toBe('Every month on the 1st');
    expect(scheduleText('monthly', 22)).toBe('Every month on the 22nd');
    expect(scheduleText('monthly', 11)).toBe('Every month on the 11th');
    expect(scheduleText('monthly', 31)).toBe('Every month on the 31st (or the last day)');
  });
});

describe('todayIn', () => {
  it('uses the time zone, not UTC', () => {
    const lateUtc = new Date('2026-10-01T20:00:00Z'); // 01:30 on 2 Oct in India
    expect(todayIn('Asia/Kolkata', lateUtc)).toBe('2026-10-02');
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-01');
  });
});
