import { formatAmount, type ExpenseDetail as Detail, type ExpenseView, type GroupDetail } from '@splity/shared';
import { Pencil, Plus, Repeat, RotateCcw, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Avatar, EmptyState, Sheet, TopBar, useToast } from '../components/ui';
import {
  conflictOf,
  errorMessage,
  useCreateExpense,
  useDeleteExpense,
  useExpense,
  useFriends,
  useGroup,
  useGroups,
  useOpenDirect,
  useRestoreExpense,
  useUpdateExpense,
} from '../lib/api';
import { CATEGORY_LABELS, CategoryIcon, diffSnapshots, nameLookup, type DiffLine } from '../lib/expenses';
import { ExpenseForm } from './ExpenseForm';

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

/** (+) key: "Which group or friend?" (skipped when there is only one choice). */
export function PickGroup() {
  const groups = useGroups();
  const friends = useFriends();
  const openDirect = useOpenDirect();
  const navigate = useNavigate();
  const toast = useToast();
  if (groups.isPending || friends.isPending) return <Loading />;
  if (groups.isError) return <Failed error={groups.error} back="/" />;
  const listed = groups.data.filter((g) => !g.isDirect && !g.youAreRemoved);
  const people = friends.data ?? [];
  if (listed.length === 1 && people.length === 0) return <Navigate to={`/groups/${listed[0]!.id}/expenses/new`} replace />;

  async function withFriend(userId: string) {
    try {
      const direct = await openDirect.mutateAsync(userId);
      void navigate(`/groups/${direct.id}/expenses/new`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  if (listed.length === 0 && people.length === 0) {
    return (
      <main className="screen screen--with-tabs">
        <TopBar title="Add expense" />
        <EmptyState
          icon={Users}
          line="> NO GROUPS YET"
          text="Expenses live in groups. Create one first."
          action={
            <Link to="/groups/new" className="key key--primary">
              Create a group
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="screen screen--with-tabs">
      <TopBar title="Add expense" />
      {listed.length > 0 && (
        <section>
          <h2 className="label section-label">Which group?</h2>
          <ul className="list">
            {listed.map((g) => (
              <li key={g.id}>
                <Link to={`/groups/${g.id}/expenses/new`} className="row">
                  <Avatar name={g.name} />
                  <span className="row__main row__title">{g.name}</span>
                  <Plus size={20} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.length > 0 && (
        <section>
          <h2 className="label section-label">Or with a friend</h2>
          <ul className="list">
            {people.map((f) => (
              <li key={f.userId}>
                <button type="button" className="row" disabled={openDirect.isPending} onClick={() => withFriend(f.userId)}>
                  <Avatar name={f.displayName} photoUrl={f.photoUrl} />
                  <span className="row__main row__title">{f.displayName}</span>
                  <Plus size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export function AddExpense() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const create = useCreateExpense(groupId);
  const navigate = useNavigate();
  const toast = useToast();

  if (group.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  return (
    <main className="screen">
      <TopBar back={`/groups/${groupId}`} title="Add expense" />
      <p className="label text-secondary">{group.data.name}</p>
      <ExpenseForm
        group={group.data}
        submitLabel="Save expense"
        allowRepeat
        pending={create.isPending}
        error={create.isError ? errorMessage(create.error) : null}
        onSubmit={async (input) => {
          try {
            await create.mutateAsync(input);
            toast('Expense added');
            void navigate(`/groups/${groupId}`, { replace: true });
          } catch {
            // shown in the form
          }
        }}
      />
    </main>
  );
}

export function EditExpense() {
  const { groupId = '', expenseId = '' } = useParams();
  const group = useGroup(groupId);
  const detail = useExpense(groupId, expenseId);
  const update = useUpdateExpense(groupId, expenseId);
  const navigate = useNavigate();
  const toast = useToast();
  /** Set when someone else saved first; the form restarts from `current` on Reload. */
  const [conflict, setConflict] = useState<{ changedBy: string; base: ExpenseView; current: ExpenseView } | null>(null);
  const [base, setBase] = useState<ExpenseView | null>(null);

  if (group.isPending || detail.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  if (detail.isError) return <Failed error={detail.error} back={`/groups/${groupId}`} />;

  const expense = base ?? detail.data.expense;
  if (expense.deleted) return <Navigate to={`/groups/${groupId}/expenses/${expenseId}`} replace />;

  return (
    <main className="screen">
      <TopBar back={`/groups/${groupId}/expenses/${expenseId}`} title="Edit expense" />
      {conflict && (
        <ConflictBanner
          group={group.data}
          conflict={conflict}
          onReload={() => {
            setBase(conflict.current);
            setConflict(null);
          }}
        />
      )}
      <ExpenseForm
        key={expense.version}
        group={group.data}
        expense={expense}
        submitLabel="Save changes"
        pending={update.isPending}
        error={update.isError && !conflictOf(update.error) ? errorMessage(update.error) : null}
        onSubmit={async (input) => {
          try {
            await update.mutateAsync({ ...input, version: expense.version });
            toast('Expense updated');
            void navigate(`/groups/${groupId}/expenses/${expenseId}`, { replace: true });
          } catch (e) {
            const c = conflictOf(e);
            if (c) setConflict({ changedBy: c.changedBy, base: expense, current: c.current });
          }
        }}
      />
    </main>
  );
}

function ConflictBanner(props: {
  group: GroupDetail;
  conflict: { changedBy: string; base: ExpenseView; current: ExpenseView };
  onReload: () => void;
}) {
  const { group, conflict } = props;
  const lines = diffSnapshots(conflict.base, conflict.current, nameLookup(group), group.currency);
  return (
    <div className="banner stack stack--sm" role="alert">
      <p>
        <span className="led led--amber" aria-hidden="true" /> {conflict.changedBy} changed this while you were editing.
      </p>
      {conflict.current.deleted ? <p>They deleted it.</p> : <DiffList lines={lines} />}
      <button type="button" className="key key--primary" onClick={props.onReload}>
        Reload their version
      </button>
      <p className="small text-muted">Your edits aren't saved. Reload, then make them again.</p>
    </div>
  );
}

function DiffList({ lines }: { lines: DiffLine[] }) {
  return (
    <ul className="diff">
      {lines.map((l) => (
        <li key={l.field}>
          <p className="diff__line diff__line--del">
            <span>-</span>
            <span>{l.field}</span>
            <span>{l.from}</span>
          </p>
          <p className="diff__line diff__line--add">
            <span>+</span>
            <span>{l.field}</span>
            <span>{l.to}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

/** X2 Expense detail. */
export function ExpenseDetail() {
  const { groupId = '', expenseId = '' } = useParams();
  const group = useGroup(groupId);
  const detail = useExpense(groupId, expenseId);

  if (group.isPending || detail.isPending) return <Loading />;
  if (group.isError) return <Failed error={group.error} back="/" />;
  if (detail.isError) return <Failed error={detail.error} back={`/groups/${groupId}`} />;
  return <ExpenseDetailView group={group.data} detail={detail.data} />;
}

function ExpenseDetailView({ group, detail }: { group: GroupDetail; detail: Detail }) {
  const { expense: e, history } = detail;
  const name = nameLookup(group);
  const cur = group.currency;
  const canWrite = group.you.status === 'active' && !group.archived;
  const del = useDeleteExpense(group.id, e.id);
  const restore = useRestoreExpense(group.id, e.id);
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const methodLabel = { equal: 'Split equally', exact: 'Split by exact amounts', shares: 'Split by shares' }[e.splitMethod];

  return (
    <main className="screen screen--with-tabs">
      <TopBar back={`/groups/${group.id}`} title={e.description} />

      {e.deleted && (
        <p className="banner" role="status">
          This expense was deleted. It doesn't count towards balances until it's restored.
        </p>
      )}
      {e.recurringSeriesId && (
        <Link to={`/groups/${group.id}/recurring`} className="row">
          <Repeat size={18} aria-hidden="true" />
          <span className="row__main">
            <span className="row__title" style={{ display: 'block' }}>
              Repeating expense
            </span>
            <span className="small text-muted">Editing this one changes the ones after it, if it's the latest.</span>
          </span>
          <span className="text-muted">›</span>
        </Link>
      )}

      <section className="readout" aria-label="Amount">
        <p className="label readout__label">
          <CategoryIcon category={e.category} size={16} /> {CATEGORY_LABELS[e.category]} // {e.expenseDate}
        </p>
        <p className={`readout__value ${e.deleted ? 'text-muted' : 'glow-green'}`}>{formatAmount(e.amountMinor, cur)}</p>
        {e.originalCurrency && e.originalAmountMinor !== null && (
          <p className="fx-line">
            {formatAmount(e.originalAmountMinor, e.originalCurrency)} at 1 {e.originalCurrency} = {e.fxRate} {cur}
          </p>
        )}
      </section>

      <section>
        <h2 className="label section-label">Paid by</h2>
        <dl className="kv">
          {e.payers.map((p) => (
            <div key={p.memberId} style={{ display: 'contents' }}>
              <dt>{name(p.memberId)}</dt>
              <dd className="amount">{formatAmount(p.paidMinor, cur)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="label section-label">{methodLabel}</h2>
        <dl className="kv">
          {e.splits.map((s) => (
            <div key={s.memberId} style={{ display: 'contents' }}>
              <dt>
                {name(s.memberId)}
                {s.shares !== null && <span className="text-muted"> × {s.shares}</span>}
              </dt>
              <dd className="amount">{formatAmount(s.owedMinor, cur)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {e.notes && (
        <section>
          <h2 className="label section-label">Note</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.notes}</p>
        </section>
      )}

      {canWrite && (
        <div className="input-row">
          {e.deleted ? (
            <button
              type="button"
              className="key key--primary key--block"
              disabled={restore.isPending}
              onClick={async () => {
                try {
                  await restore.mutateAsync(e.version);
                  toast('Expense restored');
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              <RotateCcw size={18} aria-hidden="true" /> Restore
            </button>
          ) : (
            <>
              <Link to={`/groups/${group.id}/expenses/${e.id}/edit`} className="key key--secondary" style={{ flex: 1 }}>
                <Pencil size={18} aria-hidden="true" /> Edit
              </Link>
              <button type="button" className="key key--danger" style={{ flex: 1 }} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={18} aria-hidden="true" /> Delete
              </button>
            </>
          )}
        </div>
      )}

      <section aria-label="Edit history">
        <h2 className="label section-label">History</h2>
        <ol className="diff">
          {history.map((h, i) => {
            const prev = history[i - 1];
            const lines = h.action === 'update' && prev ? diffSnapshots(prev.snapshot, h.snapshot, name, cur) : [];
            const verb = { create: 'added it', update: 'edited', delete: 'deleted it', restore: 'restored it', dispute: 'disputed', merge_repoint: 'merged a member' }[h.action];
            return (
              <li key={h.version}>
                <p className="diff__head">
                  v{h.version} {(h.actorName ?? 'System').toUpperCase()} · {verb} · <time dateTime={h.createdAt}>{ago(h.createdAt)}</time>
                </p>
                {lines.length > 0 && <DiffList lines={lines} />}
              </li>
            );
          })}
        </ol>
      </section>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} label="Delete expense">
        <div className="stack">
          <h2 className="h1">Delete "{e.description}"?</h2>
          <p>It stops counting towards balances. Anyone in the group can restore it from its page.</p>
          <button
            type="button"
            className="key key--danger key--block"
            disabled={del.isPending}
            onClick={async () => {
              try {
                await del.mutateAsync(e.version);
                toast('Expense deleted');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
              setConfirmDelete(false);
            }}
          >
            Delete
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </main>
  );
}
