import {
  canRecordSettlement,
  formatAmount,
  type ExpenseView,
  type GroupDetail as Group,
  type SettlementView,
  type Transfer,
} from '@splity/shared';
import { HandCoins, Plus, Receipt, Settings, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ActivityLog } from '../components/ActivityLog';
import { Avatar, Badge, EmptyState, Money, Sheet, Toggle, TopBar, useShareLink, useToast } from '../components/ui';
import {
  ApiError,
  errorMessage,
  useBalances,
  useExpenses,
  useGroup,
  useGroupActivity,
  useReminders,
  useSendReminder,
  useSettlements,
  useUpdateGroup,
} from '../lib/api';
import { CategoryIcon, nameLookup } from '../lib/expenses';
import { signedAmount } from '../lib/format';

const TABS = ['expenses', 'balances', 'activity'] as const;
type Tab = (typeof TABS)[number];

/** G2 Group detail. */
export function GroupDetail() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t === params.get('tab')) ?? 'expenses';
  const share = useShareLink();

  if (group.isPending) {
    return (
      <main className="screen screen--with-tabs" aria-busy="true">
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </main>
    );
  }
  if (group.isError) {
    return (
      <main className="screen screen--with-tabs">
        <TopBar back="/" title="Group" />
        <p className="banner banner--error" role="alert">
          {errorMessage(group.error)}
        </p>
      </main>
    );
  }

  const g = group.data;
  const me = g.members.find((m) => m.isYou)!;
  const canWrite = g.you.status === 'active' && !g.archived;

  return (
    <main className="screen screen--with-tabs">
      <TopBar
        back="/"
        title={g.name}
        end={
          <Link to={`/groups/${g.id}/settings`} className="icon-button" aria-label="Group settings">
            <Settings size={22} aria-hidden="true" />
          </Link>
        }
      />

      {g.you.status === 'removed' && (
        <p className="banner" role="status">
          You were removed from this group. You can still see it and settle up.
        </p>
      )}

      <section className="readout" aria-label="Your balance in this group">
        <p className="label readout__label">Your balance // {g.currency}</p>
        {me.netMinor === 0 ? (
          <p className="readout__value text-muted">ALL SQUARE</p>
        ) : (
          <>
            <p className="label text-secondary">{me.netMinor > 0 ? 'You are owed' : 'You owe'}</p>
            <p className={`readout__value ${me.netMinor > 0 ? 'glow-green' : 'glow-amber'}`}>
              {formatAmount(Math.abs(me.netMinor), g.currency)}
            </p>
          </>
        )}
      </section>

      {canWrite && (
        <div className="input-row">
          <Link to={`/groups/${g.id}/expenses/new`} className="key key--primary" style={{ flex: 1 }}>
            <Plus size={20} aria-hidden="true" />
            Add expense
          </Link>
          {g.inviteUrl && (
            <button type="button" className="key key--secondary" onClick={() => share(g.inviteUrl!, g.name)}>
              <UserPlus size={20} aria-hidden="true" />
              Invite
            </button>
          )}
        </div>
      )}

      <div className="segmented" role="tablist" aria-label="Group sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className="segmented__item"
            onClick={() => setParams(t === 'expenses' ? {} : { tab: t }, { replace: true })}
          >
            {tab === t && <span className="led led--green" aria-hidden="true" />}
            {t}
          </button>
        ))}
      </div>

      <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'expenses' && <Expenses group={g} />}
        {tab === 'balances' && <Balances group={g} canWrite={canWrite} />}
        {tab === 'activity' && <GroupActivity groupId={g.id} />}
      </section>
    </main>
  );
}

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: '2-digit' });
const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short' });

function Expenses({ group }: { group: Group }) {
  const expenses = useExpenses(group.id);
  const payments = useSettlements(group.id);
  const [showDeleted, setShowDeleted] = useState(false);
  const deleted = useExpenses(group.id, { deleted: true });

  if (expenses.isPending) return <div className="skeleton" style={{ height: 160 }} />;
  if (expenses.isError) {
    return (
      <p className="banner banner--error" role="alert">
        {errorMessage(expenses.error)}
      </p>
    );
  }
  const deletedCount = deleted.data?.length ?? 0;
  return (
    <div className="stack">
      {expenses.data.length === 0 && !payments.data?.length ? (
        <EmptyState icon={Receipt} line="> NO EXPENSES YET" text="Add the first one and Splity will keep score." />
      ) : (
        <ExpenseList group={group} expenses={expenses.data} settlements={payments.data ?? []} />
      )}
      {deletedCount > 0 && (
        <button type="button" className="key key--text" onClick={() => setShowDeleted(!showDeleted)}>
          {showDeleted ? 'Hide' : 'Show'} deleted expenses ({deletedCount})
        </button>
      )}
      {showDeleted && deleted.data && <ExpenseList group={group} expenses={deleted.data} muted />}
    </div>
  );
}

type Entry = { kind: 'expense'; date: string; at: string; e: ExpenseView } | { kind: 'payment'; date: string; at: string; s: SettlementView };

/** Expenses and payments in one timeline, newest first. */
function ExpenseList(props: { group: Group; expenses: ExpenseView[]; settlements?: SettlementView[]; muted?: boolean }) {
  const { group, muted } = props;
  const name = nameLookup(group);
  const me = group.you.memberId;
  const cur = group.currency;
  const entries: Entry[] = [
    ...props.expenses.map((e) => ({ kind: 'expense' as const, date: e.expenseDate, at: e.createdAt, e })),
    ...(props.settlements ?? []).map((s) => ({ kind: 'payment' as const, date: s.settledOn, at: s.createdAt, s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  return (
    <ul className="list">
      {entries.map((entry) => {
        if (entry.kind === 'payment') return <PaymentRow key={entry.s.id} group={group} s={entry.s} />;
        const e = entry.e;
        const date = new Date(`${e.expenseDate}T00:00:00`);
        const paid = e.payers.find((p) => p.memberId === me)?.paidMinor ?? 0;
        const owed = e.splits.find((s) => s.memberId === me)?.owedMinor ?? 0;
        const involved = e.payers.some((p) => p.memberId === me) || e.splits.some((s) => s.memberId === me);
        const net = paid - owed;
        const payerText =
          e.payers.length === 1
            ? `${name(e.payers[0]!.memberId)} paid ${formatAmount(e.amountMinor, cur)}`
            : `${e.payers.length} people paid ${formatAmount(e.amountMinor, cur)}`;
        return (
          <li key={e.id}>
            <Link to={`/groups/${group.id}/expenses/${e.id}`} className={`row${muted ? ' row--muted' : ''}`}>
              <span className="date-stub" aria-hidden="true">
                <span className="date-stub__day">{dayFormat.format(date)}</span>
                <span className="date-stub__month">{monthFormat.format(date).toUpperCase()}</span>
              </span>
              <span className="row__main">
                <span className="row__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CategoryIcon category={e.category} size={16} />
                  <span className="row__title">{e.description}</span>
                </span>
                <span className="small text-muted">{payerText}</span>
              </span>
              <span className="row__end small">
                {muted ? (
                  <span className="text-muted">deleted</span>
                ) : !involved ? (
                  <span className="text-muted">not involved</span>
                ) : net === 0 ? (
                  <span className="text-muted">no balance</span>
                ) : (
                  <Money netMinor={net}>
                    <span style={{ display: 'block' }}>{net > 0 ? 'you lent' : 'you owe'}</span>
                    {formatAmount(Math.abs(net), cur)}
                  </Money>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DateStub({ iso }: { iso: string }) {
  const date = new Date(`${iso}T00:00:00`);
  return (
    <span className="date-stub" aria-hidden="true">
      <span className="date-stub__day">{dayFormat.format(date)}</span>
      <span className="date-stub__month">{monthFormat.format(date).toUpperCase()}</span>
    </span>
  );
}

function PaymentRow({ group, s }: { group: Group; s: SettlementView }) {
  const name = nameLookup(group);
  const me = group.you.memberId;
  const text = s.fromMember === me ? `You paid ${name(s.toMember)}` : s.toMember === me ? `${name(s.fromMember)} paid you` : `${name(s.fromMember)} paid ${name(s.toMember)}`;
  return (
    <li>
      <Link to={`/groups/${group.id}/settlements/${s.id}`} className="row">
        <DateStub iso={s.settledOn} />
        <span className="row__main">
          <span className="row__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <HandCoins size={16} aria-hidden="true" />
            <span className="row__title">{text}</span>
          </span>
          <span className="small text-muted">
            Payment · {s.method === 'upi' ? 'UPI' : s.method}{' '}
            {s.disputedBy && (
              <Badge tone="amber" led="amber">
                Disputed
              </Badge>
            )}
          </span>
        </span>
        <span className="row__end small amount text-secondary">{formatAmount(s.amountMinor, group.currency)}</span>
      </Link>
    </li>
  );
}

function Balances({ group, canWrite }: { group: Group; canWrite: boolean }) {
  const update = useUpdateGroup(group.id);
  const balances = useBalances(group.id);
  const [why, setWhy] = useState<Transfer | null>(null);
  const [showAll, setShowAll] = useState(false);
  const name = nameLookup(group);
  const me = group.you.memberId;
  const cur = group.currency;

  if (balances.isPending) return <div className="skeleton" style={{ height: 160 }} />;
  if (balances.isError) {
    return (
      <p className="banner banner--error" role="alert">
        {errorMessage(balances.error)}
      </p>
    );
  }

  const b = balances.data;
  const transfers = group.simplifyDebts ? b.simplified : b.raw;
  const mine = transfers.filter((t) => t.from === me || t.to === me);
  const others = transfers.filter((t) => t.from !== me && t.to !== me);
  const memberById = new Map(group.members.map((m) => [m.id, m]));
  // Removed members may still settle what they owe.
  const canSettle = !group.archived;

  return (
    <div className="stack">
      <Toggle
        label={<span className="label">Simplify debts</span>}
        checked={group.simplifyDebts}
        disabled={!canWrite || update.isPending}
        onChange={(simplifyDebts) => update.mutate({ simplifyDebts })}
      />

      <section>
        <h2 className="label section-label">Your balance</h2>
        {mine.length === 0 ? (
          <p className="text-muted">You're all settled up.</p>
        ) : (
          <ul className="list">
            {mine.map((t) => {
              const youOwe = t.from === me;
              const other = memberById.get(youOwe ? t.to : t.from);
              return (
                <li key={`${t.from}-${t.to}`} className="row">
                  <Avatar name={other?.displayName ?? '?'} photoUrl={other?.photoUrl} />
                  <span className="row__main">
                    <span className="row__title" style={{ display: 'block' }}>
                      {youOwe ? `You owe ${name(t.to)}` : `${name(t.from)} owes you`}
                    </span>
                    {group.simplifyDebts && (
                      <button type="button" className="link-button" onClick={() => setWhy(t)}>
                        why? ›
                      </button>
                    )}
                  </span>
                  <span className="row__end stack stack--sm" style={{ alignItems: 'flex-end' }}>
                    <Money netMinor={youOwe ? -1 : 1}>{formatAmount(t.amountMinor, cur)}</Money>
                    {canSettle && (
                      <span className="input-row">
                        {!youOwe && other && !other.isPlaceholder && group.you.status === 'active' && (
                          <RemindButton groupId={group.id} member={other.id} name={other.displayName} />
                        )}
                        <Link
                          to={`/groups/${group.id}/settle?from=${t.from}&to=${t.to}&amount=${t.amountMinor}`}
                          className={`key key--compact ${youOwe ? 'key--primary' : 'key--secondary'}`}
                        >
                          {youOwe ? 'Settle' : 'Record'}
                        </Link>
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="label section-label">Everyone</h2>
        <ul className="list">
          {b.net.map(({ memberId, netMinor }) => {
            const m = memberById.get(memberId);
            if (!m) return null;
            return (
              <li key={memberId} className={`row${m.status === 'removed' ? ' row--muted' : ''}`}>
                <Avatar name={m.displayName} photoUrl={m.photoUrl} />
                <span className="row__main">
                  <span className="row__title" style={{ display: 'block' }}>
                    {m.displayName}
                    {m.isYou && <span className="text-muted"> (you)</span>}
                  </span>
                  {m.isPlaceholder && <Badge>Placeholder</Badge>} {m.status === 'removed' && <Badge>Removed</Badge>}
                </span>
                <span className="row__end">
                  <Money netMinor={netMinor}>{signedAmount(netMinor, cur)}</Money>
                </span>
              </li>
            );
          })}
        </ul>
        {others.length > 0 && (
          <>
            <button type="button" className="key key--text" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              {showAll ? '▾' : '▸'} Show all payments ({transfers.length})
            </button>
            {showAll && (
              <TransferList
                transfers={transfers}
                name={name}
                currency={cur}
                recordHref={(t) => {
                  const from = memberById.get(t.from);
                  const to = memberById.get(t.to);
                  return canSettle && from && to && canRecordSettlement(me, from, to)
                    ? `/groups/${group.id}/settle?from=${t.from}&to=${t.to}&amount=${t.amountMinor}`
                    : null;
                }}
              />
            )}
          </>
        )}
        {canSettle && (
          <Link to={`/groups/${group.id}/settle`} className="key key--text">
            <HandCoins size={18} aria-hidden="true" /> Record a payment
          </Link>
        )}
      </section>

      <Sheet open={why !== null} onClose={() => setWhy(null)} label="Why this payment">
        {why && (
          <div className="stack">
            <h2 className="h1">Why {name(why.from)} → {name(why.to)}?</h2>
            <p>
              Simplifying combines everyone's debts into the fewest payments. {name(why.from)} ends up paying{' '}
              {name(why.to)} {formatAmount(why.amountMinor, cur)} instead of these, expense by expense:
            </p>
            <TransferList
              transfers={b.raw.filter((t) => t.from === why.from || t.to === why.to)}
              name={name}
              currency={cur}
            />
            <p className="small text-muted">Everyone's net balance stays exactly the same either way.</p>
            <button type="button" className="key key--primary key--block" onClick={() => setWhy(null)}>
              Got it
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const hoursAgo = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));

/** Nudge someone who owes you; once a day per person (DESIGN.md › Balance row). */
function RemindButton({ groupId, member, name }: { groupId: string; member: string; name: string }) {
  const reminders = useReminders(groupId);
  const send = useSendReminder(groupId);
  const toast = useToast();
  const recent = reminders.data?.find((r) => r.toMember === member);

  if (recent) {
    return (
      <button type="button" className="key key--compact key--secondary" disabled title={`Reminded ${hoursAgo(recent.sentAt)}h ago`}>
        Reminded {hoursAgo(recent.sentAt)}h ago
      </button>
    );
  }
  return (
    <button
      type="button"
      className="key key--compact key--secondary"
      disabled={send.isPending}
      onClick={async () => {
        try {
          const res = await send.mutateAsync(member);
          toast(res.delivered ? `Reminder sent to ${name}` : `${name} hasn't turned on notifications. Message them directly.`, res.delivered ? 'ok' : 'error');
        } catch (e) {
          toast(e instanceof ApiError ? e.message : errorMessage(e), 'error');
        }
      }}
    >
      Remind
    </button>
  );
}

function TransferList(props: {
  transfers: Transfer[];
  name: (id: string) => string;
  currency: string;
  /** Link to record this payment, when the viewer may. */
  recordHref?: (t: Transfer) => string | null;
}) {
  const { transfers, name, currency } = props;
  return (
    <ul className="log">
      {transfers.map((t) => {
        const href = props.recordHref?.(t);
        return (
          <li key={`${t.from}-${t.to}`} className="log__line" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'center' }}>
            <span>
              {name(t.from)} → {name(t.to)}
            </span>
            <span className="amount">{formatAmount(t.amountMinor, currency)}</span>
            {href ? (
              <Link to={href} className="link-button" aria-label={`Record payment from ${name(t.from)} to ${name(t.to)}`}>
                record ›
              </Link>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GroupActivity({ groupId }: { groupId: string }) {
  const activity = useGroupActivity(groupId);
  if (activity.isPending) return <div className="skeleton" style={{ height: 120 }} />;
  if (activity.isError) {
    return (
      <p className="banner banner--error" role="alert">
        {errorMessage(activity.error)}
      </p>
    );
  }
  return <ActivityLog events={activity.data} />;
}
