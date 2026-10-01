import { currencyExponent, formatAmount, type Category, type ExpenseSnapshot, type GroupDetail } from '@splity/shared';
import {
  BedDouble,
  Car,
  Clapperboard,
  HeartPulse,
  House,
  Package,
  Plane,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** DESIGN.md › Category icons (Lucide). */
export const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  general: Receipt,
  food: Utensils,
  groceries: ShoppingCart,
  travel: Plane,
  transport: Car,
  stay: BedDouble,
  rent: House,
  utilities: Zap,
  entertainment: Clapperboard,
  shopping: ShoppingBag,
  health: HeartPulse,
  other: Package,
};

export const CATEGORY_LABELS: Record<Category, string> = {
  general: 'General',
  food: 'Food & drink',
  groceries: 'Groceries',
  travel: 'Travel',
  transport: 'Transport',
  stay: 'Stay',
  rent: 'Rent',
  utilities: 'Utilities',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  health: 'Health',
  other: 'Other',
};

export function CategoryIcon({ category, size = 20 }: { category: Category; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Receipt;
  return <Icon size={size} aria-hidden="true" />;
}

/** Plain editable number for an amount input: 300050 INR → "3000.50". */
export function minorToInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Member names by id for a group, with "You" for the viewer. */
export function nameLookup(group: GroupDetail): (memberId: string) => string {
  const names = new Map(group.members.map((m) => [m.id, m.isYou ? 'You' : m.displayName]));
  return (id) => names.get(id) ?? 'Former member';
}

const payersText = (s: ExpenseSnapshot, name: (id: string) => string, currency: string) =>
  s.payers.map((p) => `${name(p.memberId)} ${formatAmount(p.paidMinor, currency)}`).join(' · ');

const splitText = (s: ExpenseSnapshot, name: (id: string) => string, currency: string) =>
  `${s.splitMethod}: ` + s.splits.map((x) => `${name(x.memberId)} ${formatAmount(x.owedMinor, currency)}`).join(' · ');

export interface DiffLine {
  field: string;
  from: string;
  to: string;
}

/** Field-by-field differences between two versions, for edit history and conflict banners. */
export function diffSnapshots(
  a: ExpenseSnapshot,
  b: ExpenseSnapshot,
  name: (id: string) => string,
  currency: string,
): DiffLine[] {
  const lines: DiffLine[] = [];
  const cmp = (field: string, from: string, to: string) => from !== to && lines.push({ field, from, to });
  cmp('description', a.description, b.description);
  cmp('amount', formatAmount(a.amountMinor, currency), formatAmount(b.amountMinor, currency));
  const fx = (s: ExpenseSnapshot) =>
    s.originalCurrency ? `${formatAmount(s.originalAmountMinor ?? 0, s.originalCurrency)} @ ${s.fxRate}` : '—';
  cmp('foreign', fx(a), fx(b));
  cmp('date', a.expenseDate, b.expenseDate);
  cmp('category', CATEGORY_LABELS[a.category], CATEGORY_LABELS[b.category]);
  cmp('notes', a.notes ?? '—', b.notes ?? '—');
  cmp('paid by', payersText(a, name, currency), payersText(b, name, currency));
  cmp('split', splitText(a, name, currency), splitText(b, name, currency));
  return lines;
}
