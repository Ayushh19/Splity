import { formatAmount, scheduleText, type RecurringSeriesView } from '@splity/shared';
import { Pause, Play, Repeat, Square } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Badge, EmptyState, TopBar, useToast } from '../components/ui';
import { errorMessage, useGroup, useRecurring, useSeriesAction } from '../lib/api';

const REASONS: Record<string, string> = {
  manual: 'Paused by hand.',
  removed_participant: 'Paused: someone in its exact split was removed from the group.',
  removed_payer: 'Paused: the person who pays it was removed from the group.',
};

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const pretty = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00`));

/** X3 Recurring series of a group. */
export function Recurring() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const list = useRecurring(groupId);

  return (
    <main className="screen screen--with-tabs">
      <TopBar back={`/groups/${groupId}`} title="Recurring" />
      {(group.isPending || list.isPending) && <div className="skeleton" style={{ height: 160 }} />}
      {list.isError && (
        <p className="banner banner--error" role="alert">
          {errorMessage(list.error)}
        </p>
      )}
      {group.data && list.data &&
        (list.data.length === 0 ? (
          <EmptyState
            icon={Repeat}
            line="> NOTHING ON REPEAT"
            text="Add an expense and tap Repeat for rent, Wi-Fi or anything else that comes back every week or month."
          />
        ) : (
          <ul className="list" style={{ gap: 'var(--space-md)' }}>
            {list.data.map((s) => (
              <SeriesCard key={s.id} series={s} currency={group.data.currency} canWrite={group.data.you.status === 'active' && !group.data.archived} />
            ))}
          </ul>
        ))}
    </main>
  );
}

function SeriesCard({ series: s, currency, canWrite }: { series: RecurringSeriesView; currency: string; canWrite: boolean }) {
  const act = useSeriesAction(s.groupId);
  const toast = useToast();

  async function run(action: 'pause' | 'resume' | 'stop', done: string) {
    try {
      await act.mutateAsync({ seriesId: s.id, action });
      toast(done);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <li className="card stack stack--sm">
      <div className="top-bar" style={{ minHeight: 0 }}>
        <span className="row__main">
          <span className="row__title" style={{ display: 'block' }}>
            {s.latest?.description ?? 'Repeating expense'}
          </span>
          <span className="small text-muted">{scheduleText(s.frequency, s.anchorDay)}</span>
        </span>
        {s.status === 'active' && <Badge led="green">Active</Badge>}
        {s.status === 'paused' && (
          <Badge tone="amber" led="amber">
            Paused
          </Badge>
        )}
        {s.status === 'stopped' && <Badge>Stopped</Badge>}
      </div>

      <dl className="kv small">
        {s.latest && (
          <>
            <dt>Amount</dt>
            <dd className="amount">{formatAmount(s.latest.amountMinor, currency)}</dd>
          </>
        )}
        {s.status === 'active' && (
          <>
            <dt>Next</dt>
            <dd>{pretty(s.nextDue)}</dd>
          </>
        )}
        <dt>So far</dt>
        <dd>{s.occurrences}</dd>
      </dl>

      {s.status === 'paused' && s.pausedReason && (
        <p className="banner">
          {REASONS[s.pausedReason]}
          {s.pausedReason !== 'manual' && s.latest && (
            <>
              {' '}
              <Link to={`/groups/${s.groupId}/expenses/${s.latest.expenseId}/edit`}>Edit the latest one</Link>, then resume. Missed
              dates are skipped.
            </>
          )}
        </p>
      )}

      {canWrite && s.status !== 'stopped' && (
        <div className="input-row">
          {s.status === 'active' ? (
            <button type="button" className="key key--secondary key--compact" disabled={act.isPending} onClick={() => run('pause', 'Paused')}>
              <Pause size={16} aria-hidden="true" /> Pause
            </button>
          ) : (
            <button type="button" className="key key--primary key--compact" disabled={act.isPending} onClick={() => run('resume', 'Resumed')}>
              <Play size={16} aria-hidden="true" /> Resume
            </button>
          )}
          <button type="button" className="key key--text" style={{ color: 'var(--danger-text)' }} disabled={act.isPending} onClick={() => run('stop', 'Stopped for good')}>
            <Square size={16} aria-hidden="true" /> Stop
          </button>
        </div>
      )}
      {s.latest && (
        <Link to={`/groups/${s.groupId}/expenses/${s.latest.expenseId}`} className="small">
          Latest: {pretty(s.latest.occurrenceDate)} ›
        </Link>
      )}
    </li>
  );
}
