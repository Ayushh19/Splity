import { formatAmount, type GroupDetail as Group } from '@splity/shared';
import { Receipt, Settings, UserPlus } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ActivityLog } from '../components/ActivityLog';
import { Avatar, Badge, EmptyState, Money, Toggle, TopBar, useShareLink } from '../components/ui';
import { errorMessage, useGroup, useGroupActivity, useUpdateGroup } from '../lib/api';
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

      {canWrite && g.inviteUrl && (
        <button type="button" className="key key--secondary" onClick={() => share(g.inviteUrl!, g.name)}>
          <UserPlus size={20} aria-hidden="true" />
          Invite friends
        </button>
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
        {tab === 'expenses' && (
          <EmptyState icon={Receipt} line="> NO EXPENSES YET" text="Adding expenses arrives in the next build." />
        )}
        {tab === 'balances' && <Balances group={g} canWrite={canWrite} />}
        {tab === 'activity' && <GroupActivity groupId={g.id} />}
      </section>
    </main>
  );
}

function Balances({ group, canWrite }: { group: Group; canWrite: boolean }) {
  const update = useUpdateGroup(group.id);
  const me = group.members.find((m) => m.isYou)!;
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
        {me.netMinor === 0 ? (
          <p className="text-muted">You're all settled up.</p>
        ) : (
          <p>
            <Money netMinor={me.netMinor}>{signedAmount(me.netMinor, group.currency)}</Money>
          </p>
        )}
      </section>

      <section>
        <h2 className="label section-label">Everyone</h2>
        <ul className="list">
          {group.members.map((m) => (
            <li key={m.id} className={`row${m.status === 'removed' ? ' row--muted' : ''}`}>
              <Avatar name={m.displayName} photoUrl={m.photoUrl} />
              <span className="row__main">
                <span className="row__title" style={{ display: 'block' }}>
                  {m.displayName}
                  {m.isYou && <span className="text-muted"> (you)</span>}
                </span>
                {m.isPlaceholder && <Badge>Placeholder</Badge>} {m.status === 'removed' && <Badge>Removed</Badge>}
              </span>
              <span className="row__end">
                <Money netMinor={m.netMinor}>{signedAmount(m.netMinor, group.currency)}</Money>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
