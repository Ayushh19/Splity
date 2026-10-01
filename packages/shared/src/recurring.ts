import * as z from 'zod';
import type { Minor } from './money';

export const FREQUENCIES = ['weekly', 'monthly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const repeatInput = z.object({ frequency: z.enum(FREQUENCIES) }).strict();
export type RepeatInput = z.infer<typeof repeatInput>;

export type PausedReason = 'manual' | 'removed_participant' | 'removed_payer';

export interface RecurringSeriesView {
  id: string;
  groupId: string;
  frequency: Frequency;
  /** Weekly: ISO weekday 1 (Mon)–7 (Sun). Monthly: day 1–31 (clamped to short months). */
  anchorDay: number;
  nextDue: string;
  status: 'active' | 'paused' | 'stopped';
  pausedReason: PausedReason | null;
  createdBy: string;
  occurrences: number;
  /** The occurrence the next one will be copied from. */
  latest: { expenseId: string; description: string; amountMinor: Minor; occurrenceDate: string } | null;
}

// Dates are calendar dates ("2026-10-01"), computed in UTC so no time zone can shift them.
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};
const format = (date: Date) => date.toISOString().slice(0, 10);
const daysInMonth = (year: number, month0: number) => new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();

/** ISO weekday (1 = Monday … 7 = Sunday) of a date. */
export function isoWeekday(iso: string): number {
  return parse(iso).getUTCDay() || 7;
}

/** The anchor a series gets from its first occurrence's date. */
export function anchorFor(frequency: Frequency, firstDate: string): number {
  return frequency === 'weekly' ? isoWeekday(firstDate) : parse(firstDate).getUTCDate();
}

/** Monthly date for an anchor in a given month, clamped (anchor 31 → 30 Apr, 28/29 Feb). */
function monthlyDate(year: number, month0: number, anchorDay: number): Date {
  return new Date(Date.UTC(year, month0, Math.min(anchorDay, daysInMonth(year, month0))));
}

/** First scheduled date strictly after `after`. */
export function nextOccurrence(frequency: Frequency, anchorDay: number, after: string): string {
  const base = parse(after);
  if (frequency === 'weekly') {
    const ahead = ((anchorDay - (base.getUTCDay() || 7) + 7) % 7) || 7;
    return format(new Date(base.getTime() + ahead * 86_400_000));
  }
  const thisMonth = monthlyDate(base.getUTCFullYear(), base.getUTCMonth(), anchorDay);
  if (thisMonth > base) return format(thisMonth);
  return format(monthlyDate(base.getUTCFullYear(), base.getUTCMonth() + 1, anchorDay));
}

/** First scheduled date on or after `from` (used when resuming: missed dates are skipped). */
export function occurrenceOnOrAfter(frequency: Frequency, anchorDay: number, from: string): string {
  const dayBefore = format(new Date(parse(from).getTime() - 86_400_000));
  return nextOccurrence(frequency, anchorDay, dayBefore);
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Every Monday" / "Every month on the 1st" / "Every month on the 31st (or the last day)". */
export function scheduleText(frequency: Frequency, anchorDay: number): string {
  if (frequency === 'weekly') return `Every ${WEEKDAYS[anchorDay - 1]}`;
  return `Every month on the ${ordinal(anchorDay)}${anchorDay > 28 ? ' (or the last day)' : ''}`;
}

/** Today's calendar date in a time zone, e.g. todayIn('Asia/Kolkata') → "2026-10-01". */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
