import * as z from 'zod';
import type { Transfer } from './balances';
import type { Minor } from './money';
import { repeatInput } from './recurring';
import { currencyCode } from './schemas';

export const CATEGORIES = [
  'general',
  'food',
  'groceries',
  'travel',
  'transport',
  'stay',
  'rent',
  'utilities',
  'entertainment',
  'shopping',
  'health',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** ₹10,00,00,000 — the cap is 10^9 major units of the group currency. */
export const MAX_EXPENSE_MAJOR_UNITS = 1_000_000_000;

const minorAmount = z.number().int().positive();
const memberId = z.uuid();

export const splitInput = z.discriminatedUnion('method', [
  z.object({ method: z.literal('equal'), participants: z.array(memberId).min(1, 'Pick at least one person') }),
  z.object({
    method: z.literal('exact'),
    amounts: z.array(z.object({ memberId, amountMinor: z.number().int().nonnegative() })).min(1, 'Pick at least one person'),
  }),
  z.object({
    method: z.literal('shares'),
    shares: z.array(z.object({ memberId, shares: z.number().int().min(1).max(1000) })).min(1, 'Pick at least one person'),
  }),
]);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

export const expenseInput = z
  .object({
    description: z.string().trim().min(1, 'What was it for?').max(100, 'Keep it under 100 characters'),
    category: z.enum(CATEGORIES).default('general'),
    notes: z.string().trim().max(1000).nullable().default(null),
    expenseDate: isoDate,
    /**
     * Total in the group currency. Ignored when `foreign` is set: the server
     * recomputes it from the foreign amount and rate.
     */
    amountMinor: minorAmount,
    /** Entered in another currency with a manual exchange rate. */
    foreign: z
      .object({
        currency: currencyCode,
        amountMinor: minorAmount,
        /** Group-currency units per one foreign unit, as typed (e.g. "2.35"). */
        rate: z.string().regex(/^\d+(\.\d{1,10})?$/, 'Enter a rate like 2.35'),
      })
      .nullable()
      .default(null),
    payers: z
      .array(z.object({ memberId, paidMinor: minorAmount }))
      .min(1, 'Someone has to have paid'),
    split: splitInput,
    /** Create only: make this the first occurrence of a recurring series. */
    repeat: repeatInput.nullable().default(null),
  })
  .strict();
export type ExpenseInput = z.input<typeof expenseInput>;
export type ParsedExpenseInput = z.output<typeof expenseInput>;

export const expenseUpdate = expenseInput.omit({ repeat: true }).extend({ version: z.number().int().min(1) }).strict();
export type ExpenseUpdate = z.input<typeof expenseUpdate>;

export const versionBody = z.object({ version: z.number().int().min(1) }).strict();

export interface ExpenseSnapshot {
  description: string;
  category: Category;
  notes: string | null;
  expenseDate: string;
  amountMinor: Minor;
  splitMethod: 'equal' | 'exact' | 'shares';
  originalCurrency: string | null;
  originalAmountMinor: Minor | null;
  fxRate: string | null;
  payers: { memberId: string; paidMinor: Minor }[];
  splits: { memberId: string; owedMinor: Minor; shares: number | null; exactMinor: Minor | null }[];
  deleted: boolean;
}

export interface ExpenseView extends ExpenseSnapshot {
  id: string;
  groupId: string;
  createdBy: string | null;
  recurringSeriesId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RevisionView {
  version: number;
  action: 'create' | 'update' | 'delete' | 'restore' | 'dispute' | 'merge_repoint';
  actorName: string | null;
  createdAt: string;
  snapshot: ExpenseSnapshot;
}

export interface ExpenseDetail {
  expense: ExpenseView;
  history: RevisionView[];
}

export interface GroupBalances {
  currency: string;
  simplifyDebts: boolean;
  net: { memberId: string; netMinor: Minor }[];
  /** Unsimplified "who owes whom" (per-expense transfers netted per pair). */
  raw: Transfer[];
  /** Fewest payments over the net balances. */
  simplified: Transfer[];
}
