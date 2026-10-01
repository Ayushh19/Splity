import {
  CATEGORIES,
  computeSplit,
  convertWithRate,
  formatAmount,
  anchorFor,
  memberOrder,
  MoneyError,
  parseAmount,
  scheduleText,
  type Category,
  type ExpenseInput,
  type Frequency,
  type ExpenseView,
  type GroupDetail,
  type MemberView,
  type Owed,
} from '@splity/shared';
import { Calendar, NotebookPen, Repeat, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Sheet } from '../components/ui';
import { CATEGORY_LABELS, CategoryIcon, minorToInput, todayLocal } from '../lib/expenses';
import { CURRENCIES } from '../lib/format';

type SplitRequest = ExpenseInput['split'];
type Method = SplitRequest['method'];

interface FormState {
  description: string;
  category: Category;
  notes: string;
  date: string;
  amountText: string;
  /** null = the group currency. */
  foreignCurrency: string | null;
  rateText: string;
  payerMode: 'single' | 'multiple';
  payerId: string;
  payerAmounts: Record<string, string>;
  method: Method;
  equalIds: string[];
  exactAmounts: Record<string, string>;
  shares: Record<string, number>;
}

function initialState(group: GroupDetail, eligible: MemberView[], me: MemberView, expense?: ExpenseView): FormState {
  const activeIds = eligible.filter((m) => m.status === 'active').map((m) => m.id);
  const state: FormState = {
    description: '',
    category: 'general',
    notes: '',
    date: todayLocal(),
    amountText: '',
    foreignCurrency: null,
    rateText: '',
    payerMode: 'single',
    payerId: me.id,
    payerAmounts: {},
    method: 'equal',
    equalIds: activeIds,
    exactAmounts: {},
    shares: Object.fromEntries(activeIds.map((id) => [id, 1])),
  };
  if (!expense) return state;

  const cur = group.currency;
  state.description = expense.description;
  state.category = expense.category;
  state.notes = expense.notes ?? '';
  state.date = expense.expenseDate;
  if (expense.originalCurrency && expense.originalAmountMinor !== null) {
    state.foreignCurrency = expense.originalCurrency;
    state.amountText = minorToInput(expense.originalAmountMinor, expense.originalCurrency);
    state.rateText = expense.fxRate ?? '';
  } else {
    state.amountText = minorToInput(expense.amountMinor, cur);
  }
  if (expense.payers.length === 1) {
    state.payerId = expense.payers[0]!.memberId;
  } else {
    state.payerMode = 'multiple';
    state.payerAmounts = Object.fromEntries(expense.payers.map((p) => [p.memberId, minorToInput(p.paidMinor, cur)]));
  }
  state.method = expense.splitMethod;
  state.equalIds = expense.splits.map((s) => s.memberId);
  if (expense.splitMethod === 'exact') {
    state.exactAmounts = Object.fromEntries(expense.splits.map((s) => [s.memberId, minorToInput(s.exactMinor ?? s.owedMinor, cur)]));
  }
  if (expense.splitMethod === 'shares') {
    state.shares = Object.fromEntries(eligible.map((m) => [m.id, expense.splits.find((s) => s.memberId === m.id)?.shares ?? 0]));
  }
  return state;
}

/** Parse "1,200.50" in a currency to minor units; empty or invalid → null. */
function tryParse(text: string, currency: string): number | null {
  if (!text.trim()) return null;
  try {
    return parseAmount(text, currency);
  } catch {
    return null;
  }
}

interface Derived {
  totalMinor: number | null;
  payers: { memberId: string; paidMinor: number }[];
  payerSum: number;
  split: SplitRequest;
  exactSum: number;
  owed: Owed[] | null;
  problem: string | null;
}

function derive(s: FormState, group: GroupDetail, eligible: MemberView[]): Derived {
  const cur = group.currency;
  const order = memberOrder(group.members.map((m) => ({ id: m.id, sortKey: m.sortKey })));
  const fmt = (minor: number) => formatAmount(minor, cur);

  let totalMinor: number | null = null;
  let amountProblem: string | null = null;
  if (s.foreignCurrency) {
    const foreign = tryParse(s.amountText, s.foreignCurrency);
    if (foreign && /^\d+(\.\d{1,10})?$/.test(s.rateText.trim()) && Number(s.rateText) > 0) {
      try {
        totalMinor = convertWithRate(foreign, s.foreignCurrency, s.rateText.trim(), cur);
      } catch (e) {
        amountProblem = e instanceof MoneyError ? e.message : 'Check the amount and rate';
      }
    } else if (foreign) {
      amountProblem = `Enter the exchange rate (1 ${s.foreignCurrency} = ? ${cur})`;
    }
  } else {
    totalMinor = tryParse(s.amountText, cur);
  }

  const payers =
    s.payerMode === 'single'
      ? totalMinor
        ? [{ memberId: s.payerId, paidMinor: totalMinor }]
        : []
      : eligible
          .map((m) => ({ memberId: m.id, paidMinor: tryParse(s.payerAmounts[m.id] ?? '', cur) ?? 0 }))
          .filter((p) => p.paidMinor > 0);
  const payerSum = payers.reduce((a, p) => a + p.paidMinor, 0);

  const split: SplitRequest =
    s.method === 'equal'
      ? { method: 'equal', participants: s.equalIds }
      : s.method === 'exact'
        ? {
            method: 'exact',
            amounts: eligible
              .map((m) => ({ memberId: m.id, amountMinor: tryParse(s.exactAmounts[m.id] ?? '', cur) ?? 0 }))
              .filter((a) => a.amountMinor > 0),
          }
        : {
            method: 'shares',
            shares: eligible.filter((m) => (s.shares[m.id] ?? 0) > 0).map((m) => ({ memberId: m.id, shares: s.shares[m.id]! })),
          };
  const exactSum = split.method === 'exact' ? split.amounts.reduce((a, x) => a + x.amountMinor, 0) : 0;

  let owed: Owed[] | null = null;
  if (totalMinor && totalMinor > 0) {
    try {
      owed = computeSplit(totalMinor, split, order);
    } catch {
      owed = null;
    }
  }

  const problem = (() => {
    if (!s.description.trim()) return 'Add a description';
    if (amountProblem) return amountProblem;
    if (!totalMinor) return 'Enter an amount';
    if (s.payerMode === 'multiple' && payerSum !== totalMinor) {
      const left = totalMinor - payerSum;
      return left > 0 ? `Payers add up to ${fmt(payerSum)} — ${fmt(left)} left` : `Payers add up to ${fmt(payerSum)} — ${fmt(-left)} too much`;
    }
    if (split.method === 'equal' && split.participants.length === 0) return 'Pick at least one person to split with';
    if (split.method === 'shares' && split.shares.length === 0) return 'Give at least one person a share';
    if (split.method === 'exact' && exactSum !== totalMinor) {
      const left = totalMinor - exactSum;
      return left > 0 ? `Split adds up to ${fmt(exactSum)} — ${fmt(left)} left` : `Split adds up to ${fmt(exactSum)} — ${fmt(-left)} too much`;
    }
    if (!owed) return 'Check the split';
    return null;
  })();

  return { totalMinor, payers, payerSum, split, exactSum, owed, problem };
}

export interface ExpenseFormProps {
  group: GroupDetail;
  expense?: ExpenseView;
  submitLabel: string;
  /** Offer "Repeat" (new expenses only; occurrences are edited one at a time). */
  allowRepeat?: boolean;
  pending: boolean;
  error?: string | null;
  onSubmit: (input: ExpenseInput) => void;
}

/** X1 Add / edit expense (SCREENS.md › Add expense form, DESIGN.md › Components). */
export function ExpenseForm({ group, expense, submitLabel, allowRepeat, pending, error, onSubmit }: ExpenseFormProps) {
  const me = group.members.find((m) => m.isYou)!;
  // Active members, plus removed members already in this expense (they may stay in it).
  const eligible = useMemo(() => {
    const inExpense = new Set([...(expense?.payers ?? []).map((p) => p.memberId), ...(expense?.splits ?? []).map((s) => s.memberId)]);
    return group.members.filter((m) => m.status === 'active' || inExpense.has(m.id));
  }, [group, expense]);
  const [s, setS] = useState(() => initialState(group, eligible, me, expense));
  const [sheet, setSheet] = useState<'payer' | 'split' | 'category' | 'currency' | 'repeat' | null>(null);
  const [repeat, setRepeat] = useState<Frequency | null>(null);
  const [showNotes, setShowNotes] = useState(Boolean(expense?.notes));
  const d = derive(s, group, eligible);
  const set = (patch: Partial<FormState>) => setS((prev) => ({ ...prev, ...patch }));
  const cur = group.currency;
  const nameOf = (m: MemberView) => (m.isYou ? 'you' : m.displayName);
  const activeCount = eligible.filter((m) => m.status === 'active').length;

  const payerLabel =
    s.payerMode === 'single' ? nameOf(eligible.find((m) => m.id === s.payerId) ?? me) : `${d.payers.length} people`;
  const splitLabel =
    s.method === 'equal'
      ? s.equalIds.length === activeCount && s.equalIds.every((id) => eligible.find((m) => m.id === id)?.status === 'active')
        ? `equally among all ${activeCount}`
        : `equally among ${s.equalIds.length}`
      : s.method === 'exact'
        ? 'by exact amounts'
        : 'by shares';

  const resultText = (() => {
    if (!d.owed || d.owed.length === 0) return null;
    const amounts = d.owed.map((o) => o.owedMinor);
    if (amounts.every((a) => a === amounts[0])) return `${formatAmount(amounts[0]!, cur)} each`;
    const shown = amounts.slice(0, 4).map((a) => formatAmount(a, cur)).join(' · ');
    return amounts.length > 4 ? `${shown} · …` : shown;
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (d.problem || !d.totalMinor) return;
    const foreign =
      s.foreignCurrency && tryParse(s.amountText, s.foreignCurrency)
        ? { currency: s.foreignCurrency, amountMinor: tryParse(s.amountText, s.foreignCurrency)!, rate: s.rateText.trim() }
        : null;
    onSubmit({
      description: s.description.trim(),
      category: s.category,
      notes: s.notes.trim() || null,
      expenseDate: s.date,
      amountMinor: d.totalMinor,
      foreign,
      payers: d.payers,
      split: d.split,
      ...(allowRepeat ? { repeat: repeat ? { frequency: repeat } : null } : {}),
    });
  }

  const tomorrow = (() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="description-row">
        <button type="button" className="category-button" aria-label={`Category: ${CATEGORY_LABELS[s.category]}`} onClick={() => setSheet('category')}>
          <CategoryIcon category={s.category} size={22} />
        </button>
        <label className="visually-hidden" htmlFor="description">
          Description
        </label>
        <input
          id="description"
          className="input"
          placeholder="What was it for?"
          maxLength={100}
          value={s.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <div>
        <div className="amount-input">
          <button type="button" className="amount-input__currency" aria-label="Change currency" onClick={() => setSheet('currency')}>
            {s.foreignCurrency ?? cur}
          </button>
          <label className="visually-hidden" htmlFor="amount">
            Amount
          </label>
          <input
            id="amount"
            className="amount-input__field"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={s.amountText}
            onChange={(e) => set({ amountText: e.target.value })}
          />
        </div>
        {s.foreignCurrency && (
          <p className="fx-line">
            1 {s.foreignCurrency} = {s.rateText || '?'} {cur}
            {d.totalMinor ? ` → ${formatAmount(d.totalMinor, cur)}` : ''}
          </p>
        )}
      </div>

      <div>
        <p className="summary-line">
          Paid by{' '}
          <button type="button" className="summary-chip" onClick={() => setSheet('payer')}>
            {payerLabel}
          </button>{' '}
          · split{' '}
          <button type="button" className="summary-chip" onClick={() => setSheet('split')}>
            {splitLabel}
          </button>
        </p>
        {resultText && <p className="small text-muted amount">{resultText}</p>}
      </div>

      <div className="chip-row">
        <label className="chip chip--button">
          <Calendar size={16} aria-hidden="true" />
          <span className="visually-hidden">Date</span>
          <input type="date" value={s.date} max={tomorrow} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </label>
        <button type="button" className="chip chip--button" onClick={() => setSheet('category')}>
          <CategoryIcon category={s.category} size={16} />
          {CATEGORY_LABELS[s.category]}
        </button>
        <button type="button" className="chip chip--button" aria-pressed={showNotes} onClick={() => setShowNotes(!showNotes)}>
          <NotebookPen size={16} aria-hidden="true" />
          Note
        </button>
        {allowRepeat && (
          <button type="button" className="chip chip--button" aria-pressed={repeat !== null} onClick={() => setSheet('repeat')}>
            <Repeat size={16} aria-hidden="true" />
            {repeat ? (repeat === 'weekly' ? 'Weekly' : 'Monthly') : 'Repeat'}
          </button>
        )}
      </div>
      {repeat && <p className="small text-muted">{scheduleText(repeat, anchorFor(repeat, s.date))}, starting from this one.</p>}

      {showNotes && (
        <div className="field">
          <label className="label field__label" htmlFor="notes">
            Note
          </label>
          <textarea id="notes" className="input textarea" maxLength={1000} value={s.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      )}

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}
      {d.problem && s.amountText && <p className="problem" role="status">{d.problem}</p>}

      <button type="submit" className="key key--primary key--block" disabled={Boolean(d.problem) || pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>

      <PayerSheet open={sheet === 'payer'} onClose={() => setSheet(null)} s={s} set={set} d={d} eligible={eligible} currency={cur} />
      <SplitSheet open={sheet === 'split'} onClose={() => setSheet(null)} s={s} set={set} d={d} eligible={eligible} currency={cur} />
      <CategorySheet open={sheet === 'category'} onClose={() => setSheet(null)} value={s.category} onPick={(category) => { set({ category }); setSheet(null); }} />
      <RepeatSheet open={sheet === 'repeat'} onClose={() => setSheet(null)} value={repeat} date={s.date} onPick={(f) => { setRepeat(f); setSheet(null); }} />
      <CurrencySheet open={sheet === 'currency'} onClose={() => setSheet(null)} s={s} set={set} groupCurrency={cur} />
    </form>
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  s: FormState;
  set: (patch: Partial<FormState>) => void;
  d: Derived;
  eligible: MemberView[];
  currency: string;
}

const display = (m: MemberView) => (m.isYou ? `${m.displayName} (you)` : m.displayName);

function PayerSheet({ open, onClose, s, set, d, eligible, currency }: SheetProps) {
  const left = (d.totalMinor ?? 0) - d.payerSum;
  return (
    <Sheet open={open} onClose={onClose} label="Who paid?">
      <div className="stack">
        <h2 className="h1">Who paid?</h2>
        {s.payerMode === 'single' ? (
          <div role="radiogroup" aria-label="Payer">
            {eligible.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={s.payerId === m.id}
                className="row"
                onClick={() => {
                  set({ payerId: m.id });
                  onClose();
                }}
              >
                <span className={`led ${s.payerId === m.id ? 'led--green' : ''}`} aria-hidden="true" />
                <span className="row__main row__title">{display(m)}</span>
              </button>
            ))}
            <button
              type="button"
              className="row"
              onClick={() =>
                set({
                  payerMode: 'multiple',
                  payerAmounts: d.totalMinor ? { [s.payerId]: minorToInput(d.totalMinor, currency) } : {},
                })
              }
            >
              <span className="led" aria-hidden="true" />
              <span className="row__main row__title">Multiple people</span>
            </button>
          </div>
        ) : (
          <>
            {eligible.map((m) => (
              <div key={m.id} className="member-line">
                <label className="member-line__name" htmlFor={`paid-${m.id}`}>
                  {display(m)}
                </label>
                <input
                  id={`paid-${m.id}`}
                  className="input member-line__amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={s.payerAmounts[m.id] ?? ''}
                  onChange={(e) => set({ payerAmounts: { ...s.payerAmounts, [m.id]: e.target.value } })}
                />
              </div>
            ))}
            <p className={left === 0 ? 'text-muted small' : 'problem'}>
              {left === 0 ? 'Adds up.' : left > 0 ? `${formatAmount(left, currency)} left to assign` : `${formatAmount(-left, currency)} too much`}
            </p>
            <button type="button" className="key key--text" onClick={() => set({ payerMode: 'single' })}>
              <X size={16} aria-hidden="true" /> Just one person paid
            </button>
          </>
        )}
        <button type="button" className="key key--primary key--block" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function SplitSheet({ open, onClose, s, set, d, eligible, currency }: SheetProps) {
  const owedOf = (id: string) => d.owed?.find((o) => o.memberId === id)?.owedMinor;
  const left = (d.totalMinor ?? 0) - d.exactSum;
  const methods: { key: Method; label: string }[] = [
    { key: 'equal', label: 'Equally' },
    { key: 'exact', label: 'Exact' },
    { key: 'shares', label: 'Shares' },
  ];
  return (
    <Sheet open={open} onClose={onClose} label="Split">
      <div className="stack">
        <h2 className="h1">Split</h2>
        <div className="segmented" role="tablist" aria-label="Split method">
          {methods.map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={s.method === m.key} className="segmented__item" onClick={() => set({ method: m.key })}>
              {s.method === m.key && <span className="led led--green" aria-hidden="true" />}
              {m.label}
            </button>
          ))}
        </div>

        <div>
          {eligible.map((m) => {
            const owed = owedOf(m.id);
            return (
              <div key={m.id} className="member-line">
                {s.method === 'equal' && (
                  <input
                    id={`split-${m.id}`}
                    type="checkbox"
                    className="checkbox"
                    checked={s.equalIds.includes(m.id)}
                    onChange={(e) =>
                      set({ equalIds: e.target.checked ? [...s.equalIds, m.id] : s.equalIds.filter((id) => id !== m.id) })
                    }
                  />
                )}
                <label className="member-line__name" htmlFor={`split-${m.id}`}>
                  {display(m)}
                </label>
                {s.method === 'exact' && (
                  <input
                    id={`split-${m.id}`}
                    className="input member-line__amount"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={s.exactAmounts[m.id] ?? ''}
                    onChange={(e) => set({ exactAmounts: { ...s.exactAmounts, [m.id]: e.target.value } })}
                  />
                )}
                {s.method === 'shares' && (
                  <span className="stepper">
                    <button
                      type="button"
                      aria-label={`Fewer shares for ${m.displayName}`}
                      onClick={() => set({ shares: { ...s.shares, [m.id]: Math.max(0, (s.shares[m.id] ?? 0) - 1) } })}
                    >
                      −
                    </button>
                    <output id={`split-${m.id}`} aria-live="polite">
                      {s.shares[m.id] ?? 0}
                    </output>
                    <button
                      type="button"
                      aria-label={`More shares for ${m.displayName}`}
                      onClick={() => set({ shares: { ...s.shares, [m.id]: Math.min(1000, (s.shares[m.id] ?? 0) + 1) } })}
                    >
                      +
                    </button>
                  </span>
                )}
                {s.method !== 'exact' && (
                  <span className="member-line__owed amount text-muted">{owed !== undefined ? formatAmount(owed, currency) : '—'}</span>
                )}
              </div>
            );
          })}
        </div>

        {s.method === 'exact' && (
          <p className={left === 0 ? 'text-muted small' : 'problem'}>
            {left === 0 ? 'Adds up.' : left > 0 ? `${formatAmount(left, currency)} left` : `${formatAmount(-left, currency)} too much`}
          </p>
        )}
        <button type="button" className="key key--primary key--block" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function CategorySheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: Category; onPick: (c: Category) => void }) {
  return (
    <Sheet open={open} onClose={onClose} label="Category">
      <div className="stack">
        <h2 className="h1">Category</h2>
        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={value === c} onClick={() => onPick(c)}>
              <CategoryIcon category={c} size={22} />
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function RepeatSheet(props: { open: boolean; onClose: () => void; value: Frequency | null; date: string; onPick: (f: Frequency | null) => void }) {
  const options: { value: Frequency | null; label: string; hint: string }[] = [
    { value: null, label: 'Never', hint: 'Just this once' },
    { value: 'weekly', label: 'Weekly', hint: scheduleText('weekly', anchorFor('weekly', props.date)) },
    { value: 'monthly', label: 'Monthly', hint: scheduleText('monthly', anchorFor('monthly', props.date)) },
  ];
  return (
    <Sheet open={props.open} onClose={props.onClose} label="Repeat">
      <div className="stack">
        <h2 className="h1">Repeat</h2>
        <div role="radiogroup" aria-label="Repeat">
          {options.map((o) => (
            <button key={o.label} type="button" role="radio" aria-checked={props.value === o.value} className="row" onClick={() => props.onPick(o.value)}>
              <span className={`led ${props.value === o.value ? 'led--green' : ''}`} aria-hidden="true" />
              <span className="row__main">
                <span className="row__title" style={{ display: 'block' }}>
                  {o.label}
                </span>
                <span className="small text-muted">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="field__help">
          Each new one copies the latest, with the same split. Everyone in it gets notified. Edit the latest one to change what comes
          next.
        </p>
      </div>
    </Sheet>
  );
}

function CurrencySheet({ open, onClose, s, set, groupCurrency }: { open: boolean; onClose: () => void; s: FormState; set: (p: Partial<FormState>) => void; groupCurrency: string }) {
  const value = s.foreignCurrency ?? groupCurrency;
  return (
    <Sheet open={open} onClose={onClose} label="Currency">
      <div className="stack">
        <h2 className="h1">Currency</h2>
        <div className="field">
          <label className="label field__label" htmlFor="fx-currency">
            Paid in
          </label>
          <select
            id="fx-currency"
            className="input"
            value={value}
            onChange={(e) => set({ foreignCurrency: e.target.value === groupCurrency ? null : e.target.value })}
          >
            {[groupCurrency, ...CURRENCIES.filter((c) => c !== groupCurrency)].map((c) => (
              <option key={c} value={c}>
                {c}
                {c === groupCurrency ? ' (group currency)' : ''}
              </option>
            ))}
          </select>
        </div>
        {s.foreignCurrency && (
          <div className="field">
            <label className="label field__label" htmlFor="fx-rate">
              1 {s.foreignCurrency} = ? {groupCurrency}
            </label>
            <input
              id="fx-rate"
              className="input"
              inputMode="decimal"
              placeholder="2.35"
              value={s.rateText}
              onChange={(e) => set({ rateText: e.target.value })}
            />
            <p className="field__help">Use the rate you actually paid. It's saved with the expense and never changes.</p>
          </div>
        )}
        <button type="button" className="key key--primary key--block" onClick={onClose}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
