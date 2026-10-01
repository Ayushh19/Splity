import {
  canDisputeSettlement,
  canRecordSettlement,
  formatAmount,
  parseAmount,
  upiPayLink,
  type GroupDetail,
  type MemberView,
  type SettlementDetail as Detail,
  type SettlementMethod,
} from '@splity/shared';
import { ArrowRight, Flag, Pencil, RotateCcw, Smartphone, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge, Sheet, TopBar, useToast } from '../components/ui';
import { conflictOf, errorMessage, useGroup, useRecordSettlement, useSettlement, useSettlementAction, useUpdateSettlement } from '../lib/api';
import { minorToInput, nameLookup, todayLocal } from '../lib/expenses';

const METHODS: { key: SettlementMethod; label: string }[] = [
  { key: 'upi', label: 'UPI' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' },
];

function Loading() {
  return (
    <main className="screen" aria-busy="true">
      <div className="skeleton" style={{ height: 44 }} />
      <div className="skeleton" style={{ height: 200 }} />
    </main>
  );
}

function Failed({ error, back }: { error: unknown; back: string }) {
  return (
    <main className="screen">
      <TopBar back={back} />
      <p className="banner banner--error" role="alert">
        {errorMessage(error)}
      </p>
    </main>
  );
}

function tryParse(text: string, currency: string): number | null {
  try {
    return text.trim() ? parseAmount(text, currency) : null;
  } catch {
    return null;
  }
}

/** S1 Settle up: /groups/:id/settle?from=&to=&amount= (pre-filled from the Balances tab). */
export function SettleUp() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  if (group.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  return <SettleForm group={group.data} />;
}

function SettleForm({ group }: { group: GroupDetail }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const recordPayment = useRecordSettlement(group.id);
  const me = group.members.find((m) => m.isYou)!;
  const people = group.members.filter((m) => m.status !== 'merged');
  const byId = new Map(people.map((m) => [m.id, m]));
  const cur = group.currency;

  const initialAmount = Number(params.get('amount'));
  const [fromId, setFromId] = useState(byId.has(params.get('from') ?? '') ? params.get('from')! : me.id);
  const [toId, setToId] = useState(byId.has(params.get('to') ?? '') ? params.get('to')! : (people.find((m) => m.id !== me.id)?.id ?? ''));
  const [amountText, setAmountText] = useState(initialAmount > 0 ? minorToInput(initialAmount, cur) : '');
  const [date, setDate] = useState(todayLocal());
  const [method, setMethod] = useState<SettlementMethod>(cur === 'INR' ? 'upi' : 'cash');

  const from = byId.get(fromId);
  const to = byId.get(toId);
  const amountMinor = tryParse(amountText, cur);
  const problem = !from || !to
    ? 'Pick who paid and who received'
    : from.id === to.id
      ? 'Pick two different people'
      : !canRecordSettlement(me.id, from, to)
        ? `Only ${from.displayName} or ${to.displayName} can record this payment`
        : !amountMinor
          ? 'Enter an amount'
          : null;

  // "Pay via UPI": you're paying someone who has a UPI ID, in rupees.
  const upi =
    from?.isYou && to?.upiId && cur === 'INR' && amountMinor
      ? upiPayLink({ upiId: to.upiId, payeeName: to.displayName, amountMinor, note: `Splity: ${group.name}` })
      : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (problem || !amountMinor) return;
    try {
      await recordPayment.mutateAsync({ fromMember: fromId, toMember: toId, amountMinor, settledOn: date, method });
      toast(`Payment of ${formatAmount(amountMinor, cur)} recorded`);
      void navigate(`/groups/${group.id}?tab=balances`, { replace: true });
    } catch {
      // shown below
    }
  }

  const option = (m: MemberView) => (
    <option key={m.id} value={m.id}>
      {m.isYou ? `${m.displayName} (you)` : m.displayName}
      {m.status === 'removed' ? ' — removed' : ''}
    </option>
  );

  return (
    <main className="screen">
      <TopBar back={`/groups/${group.id}?tab=balances`} title="Settle up" />
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="input-row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label className="label field__label" htmlFor="from">
              Paid by
            </label>
            <select id="from" className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {people.map(option)}
            </select>
          </div>
          <ArrowRight size={22} aria-hidden="true" style={{ marginBottom: 13, flex: 'none' }} />
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label className="label field__label" htmlFor="to">
              Paid to
            </label>
            <select id="to" className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
              {people.map(option)}
            </select>
          </div>
        </div>

        <div className="amount-input">
          <span className="amount-input__currency" style={{ display: 'grid', placeItems: 'center' }}>
            {cur}
          </span>
          <label className="visually-hidden" htmlFor="settle-amount">
            Amount
          </label>
          <input
            id="settle-amount"
            className="amount-input__field"
            inputMode="decimal"
            placeholder="0.00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
        {initialAmount > 0 && amountMinor !== null && amountMinor !== initialAmount && (
          <p className="small text-muted">
            {amountMinor < initialAmount ? 'Partial payment' : 'More than owed — the balance will flip'} (owed{' '}
            {formatAmount(initialAmount, cur)})
          </p>
        )}

        <MethodPicker value={method} onChange={setMethod} />

        <div className="field">
          <label className="label field__label" htmlFor="settle-date">
            Date
          </label>
          <input id="settle-date" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ colorScheme: 'dark' }} />
        </div>

        {recordPayment.isError && (
          <p className="banner banner--error" role="alert">
            {errorMessage(recordPayment.error)}
          </p>
        )}
        {problem && amountText && <p className="problem">{problem}</p>}

        {upi && (
          <a href={upi} className="key key--secondary key--block">
            <Smartphone size={20} aria-hidden="true" />
            Pay {formatAmount(amountMinor!, cur)} via UPI
          </a>
        )}
        <button type="submit" className="key key--primary key--block" disabled={Boolean(problem) || recordPayment.isPending}>
          {recordPayment.isPending ? 'Saving…' : 'Record payment'}
        </button>
        {upi && <p className="small text-muted">After paying in your UPI app, come back and record it.</p>}
        {from?.isYou && to && !to.isPlaceholder && !to.upiId && cur === 'INR' && (
          <p className="small text-muted">{to.displayName} hasn't added a UPI ID, so pay them however you like and record it here.</p>
        )}
      </form>
    </main>
  );
}

function MethodPicker({ value, onChange }: { value: SettlementMethod; onChange: (m: SettlementMethod) => void }) {
  return (
    <div className="field">
      <span className="label field__label" id="method-label">
        Paid with
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby="method-label">
        {METHODS.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={value === m.key} aria-selected={value === m.key} className="segmented__item" onClick={() => onChange(m.key)}>
            {value === m.key && <span className="led led--green" aria-hidden="true" />}
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Edit amount/date/method of a recorded payment (clears any dispute). */
export function EditSettlement() {
  const { groupId = '', settlementId = '' } = useParams();
  const group = useGroup(groupId);
  const detail = useSettlement(groupId, settlementId);
  if (group.isPending || detail.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  if (detail.isError) return <Failed error={detail.error} back={`/groups/${groupId}`} />;
  if (detail.data.settlement.deleted) return <Navigate to={`/groups/${groupId}/settlements/${settlementId}`} replace />;
  return <EditSettlementForm key={detail.data.settlement.version} group={group.data} detail={detail.data} />;
}

function EditSettlementForm({ group, detail }: { group: GroupDetail; detail: Detail }) {
  const s = detail.settlement;
  const cur = group.currency;
  const name = nameLookup(group);
  const update = useUpdateSettlement(group.id, s.id);
  const navigate = useNavigate();
  const toast = useToast();
  const [amountText, setAmountText] = useState(minorToInput(s.amountMinor, cur));
  const [date, setDate] = useState(s.settledOn);
  const [method, setMethod] = useState<SettlementMethod>(s.method);
  const amountMinor = tryParse(amountText, cur);
  const conflict = conflictOf(update.error);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amountMinor) return;
    try {
      await update.mutateAsync({ amountMinor, settledOn: date, method, version: s.version });
      toast('Payment updated');
      void navigate(`/groups/${group.id}/settlements/${s.id}`, { replace: true });
    } catch {
      // shown below
    }
  }

  return (
    <main className="screen">
      <TopBar back={`/groups/${group.id}/settlements/${s.id}`} title="Edit payment" />
      <p className="label text-secondary">
        {name(s.fromMember)} → {name(s.toMember)}
      </p>
      {s.disputedBy && (
        <p className="banner" role="status">
          Saving changes clears {name(s.disputedBy)}'s dispute.
        </p>
      )}
      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="amount-input">
          <span className="amount-input__currency" style={{ display: 'grid', placeItems: 'center' }}>
            {cur}
          </span>
          <label className="visually-hidden" htmlFor="edit-amount">
            Amount
          </label>
          <input id="edit-amount" className="amount-input__field" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </div>
        <MethodPicker value={method} onChange={setMethod} />
        <div className="field">
          <label className="label field__label" htmlFor="edit-date">
            Date
          </label>
          <input id="edit-date" className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ colorScheme: 'dark' }} />
        </div>
        {update.isError && (
          <p className="banner banner--error" role="alert">
            {conflict ? 'Someone changed this payment meanwhile. Go back to see the latest version.' : errorMessage(update.error)}
          </p>
        )}
        <button type="submit" className="key key--primary key--block" disabled={!amountMinor || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </main>
  );
}

/** S2 Settlement detail. */
export function SettlementDetail() {
  const { groupId = '', settlementId = '' } = useParams();
  const group = useGroup(groupId);
  const detail = useSettlement(groupId, settlementId);
  if (group.isPending || detail.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  if (detail.isError) return <Failed error={detail.error} back={`/groups/${groupId}`} />;
  return <SettlementDetailView group={group.data} detail={detail.data} />;
}

function SettlementDetailView({ group, detail }: { group: GroupDetail; detail: Detail }) {
  const s = detail.settlement;
  const cur = group.currency;
  const name = nameLookup(group);
  const me = group.members.find((m) => m.isYou)!;
  const byId = new Map(group.members.map((m) => [m.id, m]));
  const from = byId.get(s.fromMember);
  const to = byId.get(s.toMember);
  const action = useSettlementAction(group.id, s.id);
  const toast = useToast();
  const [sheet, setSheet] = useState<'delete' | 'dispute' | null>(null);
  const [note, setNote] = useState('');

  const writable = !group.archived && (me.status === 'active' || me.id === s.fromMember || me.id === s.toMember);
  const canChange = writable && from !== undefined && to !== undefined && canRecordSettlement(me.id, from, to);
  const canDispute = writable && !s.deleted && !s.disputedBy && canDisputeSettlement(me.id, s);
  const canWithdraw = writable && s.disputedBy === me.id;

  async function run(vars: Parameters<typeof action.mutateAsync>[0], done: string) {
    try {
      await action.mutateAsync(vars);
      toast(done);
    } catch (err) {
      toast(conflictOf(err) ? 'Someone changed this payment meanwhile. Showing the latest.' : errorMessage(err), 'error');
    }
    setSheet(null);
  }

  const methodLabel = METHODS.find((m) => m.key === s.method)?.label ?? 'Other';
  const verbs: Record<string, string> = { create: 'recorded it', update: 'edited it', delete: 'deleted it', restore: 'restored it', dispute: 'disputed it' };

  return (
    <main className="screen screen--with-tabs">
      <TopBar back={`/groups/${group.id}`} title="Payment" />

      {s.deleted && (
        <p className="banner" role="status">
          This payment was deleted and doesn't count towards balances.
        </p>
      )}
      {s.disputedBy && (
        <div className="banner" role="status">
          <p>
            <span className="led led--amber" aria-hidden="true" /> {name(s.disputedBy)} disputed this payment.
          </p>
          {s.disputeNote && <p className="text-secondary">"{s.disputeNote}"</p>}
          <p className="small text-muted">It still counts until it's edited or deleted.</p>
        </div>
      )}

      <section className="readout" aria-label="Payment">
        <p className="label readout__label">
          {name(s.fromMember)} → {name(s.toMember)}
        </p>
        <p className={`readout__value ${s.deleted ? 'text-muted' : 'glow-green'}`}>{formatAmount(s.amountMinor, cur)}</p>
      </section>

      <dl className="kv">
        <dt>Date</dt>
        <dd>{s.settledOn}</dd>
        <dt>Paid with</dt>
        <dd>{methodLabel}</dd>
        <dt>Recorded by</dt>
        <dd>{name(s.recordedBy)}</dd>
        <dt>Status</dt>
        <dd>{s.deleted ? <Badge>Deleted</Badge> : s.disputedBy ? <Badge tone="amber" led="amber">Disputed</Badge> : <Badge led="green">OK</Badge>}</dd>
      </dl>

      <div className="stack stack--sm">
        {canChange && !s.deleted && (
          <div className="input-row">
            <Link to={`/groups/${group.id}/settlements/${s.id}/edit`} className="key key--secondary" style={{ flex: 1 }}>
              <Pencil size={18} aria-hidden="true" /> Edit
            </Link>
            <button type="button" className="key key--danger" style={{ flex: 1 }} onClick={() => setSheet('delete')}>
              <Trash2 size={18} aria-hidden="true" /> Delete
            </button>
          </div>
        )}
        {canChange && s.deleted && (
          <button type="button" className="key key--primary key--block" disabled={action.isPending} onClick={() => run({ action: 'restore', version: s.version }, 'Payment restored')}>
            <RotateCcw size={18} aria-hidden="true" /> Restore
          </button>
        )}
        {canDispute && (
          <button type="button" className="key key--secondary key--block" onClick={() => setSheet('dispute')}>
            <Flag size={18} aria-hidden="true" /> Dispute this payment
          </button>
        )}
        {canWithdraw && (
          <button type="button" className="key key--secondary key--block" disabled={action.isPending} onClick={() => run({ action: 'withdraw-dispute', version: s.version }, 'Dispute withdrawn')}>
            Withdraw my dispute
          </button>
        )}
      </div>

      <section aria-label="History">
        <h2 className="label section-label">History</h2>
        <ol className="diff">
          {detail.history.map((h, i) => {
            const prev = detail.history[i - 1]?.snapshot;
            const changes: string[] = [];
            if (h.action === 'update' && prev) {
              if (prev.amountMinor !== h.snapshot.amountMinor) changes.push(`amount ${formatAmount(prev.amountMinor, cur)} → ${formatAmount(h.snapshot.amountMinor, cur)}`);
              if (prev.settledOn !== h.snapshot.settledOn) changes.push(`date ${prev.settledOn} → ${h.snapshot.settledOn}`);
              if (prev.method !== h.snapshot.method) changes.push(`method ${prev.method} → ${h.snapshot.method}`);
              if (prev.disputedBy && !h.snapshot.disputedBy) changes.push('dispute cleared');
            }
            return (
              <li key={h.version}>
                <p className="diff__head">
                  v{h.version} {(h.actorName ?? 'System').toUpperCase()} · {verbs[h.action] ?? h.action}
                </p>
                {h.action === 'dispute' && h.snapshot.disputeNote && <p className="diff__line diff__line--del"><span>!</span><span>note</span><span>{h.snapshot.disputeNote}</span></p>}
                {changes.map((c) => (
                  <p key={c} className="diff__line diff__line--add">
                    <span>+</span>
                    <span>change</span>
                    <span>{c}</span>
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      </section>

      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} label="Delete payment">
        <div className="stack">
          <h2 className="h1">Delete this payment?</h2>
          <p>The {formatAmount(s.amountMinor, cur)} goes back onto the balance. It can be restored later.</p>
          <button type="button" className="key key--danger key--block" disabled={action.isPending} onClick={() => run({ action: 'delete', version: s.version }, 'Payment deleted')}>
            Delete
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === 'dispute'} onClose={() => setSheet(null)} label="Dispute payment">
        <div className="stack">
          <h2 className="h1">Dispute this payment?</h2>
          <p>
            {name(s.recordedBy)} gets flagged that something's wrong. The payment still counts until one of you edits or deletes it.
          </p>
          <div className="field">
            <label className="label field__label" htmlFor="dispute-note">
              What's wrong? (optional)
            </label>
            <textarea id="dispute-note" className="input textarea" maxLength={500} placeholder="I only got ₹300" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" className="key key--primary key--block" disabled={action.isPending} onClick={() => run({ action: 'dispute', version: s.version, note: note.trim() || null }, 'Payment disputed')}>
            Dispute
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setSheet(null)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </main>
  );
}
