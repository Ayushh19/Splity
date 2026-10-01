import { formatAmount, type GroupSummary } from '@splity/shared';
import { Plus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Avatar, Badge, EmptyState, Money } from '../components/ui';
import { errorMessage, useGroups } from '../lib/api';
import { yourBalanceText } from '../lib/format';

/** Totals per currency — never converted (SPEC › Balances › Home screen). */
function totalsByCurrency(groups: GroupSummary[]) {
  const totals = new Map<string, { owed: number; owe: number }>();
  for (const g of groups) {
    const t = totals.get(g.currency) ?? { owed: 0, owe: 0 };
    if (g.yourNetMinor > 0) t.owed += g.yourNetMinor;
    else t.owe -= g.yourNetMinor;
    totals.set(g.currency, t);
  }
  return [...totals.entries()];
}

/** M1 Home. */
export function Home() {
  const groups = useGroups();

  return (
    <main className="screen screen--with-tabs">
      <header className="top-bar">
        <h1 className="h1 top-bar__title glow-green">SPLITY</h1>
        <Link to="/groups/new" className="key key--secondary">
          <Plus size={18} aria-hidden="true" />
          New group
        </Link>
      </header>

      {groups.isPending && <div className="skeleton" style={{ height: 120 }} />}
      {groups.isError && (
        <p className="banner banner--error" role="alert">
          {errorMessage(groups.error)}
        </p>
      )}

      {groups.data && (
        <>
          <BalanceReadout groups={groups.data} />

          {groups.data.length === 0 ? (
            <EmptyState
              icon={Users}
              line="> NO GROUPS YET"
              text="Make a group for your flat or your next trip, then invite friends with one link."
              action={
                <Link to="/groups/new" className="key key--primary">
                  Create a group
                </Link>
              }
            />
          ) : (
            <section aria-labelledby="groups-label">
              <h2 id="groups-label" className="label section-label">
                Groups
              </h2>
              <ul className="list">
                {groups.data.map((g) => (
                  <li key={g.id}>
                    <Link to={`/groups/${g.id}`} className="row">
                      <Avatar name={g.name} />
                      <span className="row__main">
                        <span className="row__title" style={{ display: 'block' }}>
                          {g.name}
                        </span>
                        <span className="small text-muted">
                          {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                          {g.youAreRemoved && (
                            <>
                              {' · '}
                              <Badge>Removed</Badge>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="row__end small">
                        <Money netMinor={g.yourNetMinor}>{yourBalanceText(g.yourNetMinor, g.currency)}</Money>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function BalanceReadout({ groups }: { groups: GroupSummary[] }) {
  const totals = totalsByCurrency(groups).filter(([, t]) => t.owed > 0 || t.owe > 0);
  return (
    <section className="readout" aria-label="Your overall balance">
      <p className="label readout__label">Net balance</p>
      {totals.length === 0 ? (
        <p className="readout__value text-muted">ALL SQUARE</p>
      ) : (
        totals.map(([currency, t]) => (
          <div key={currency}>
            {t.owed > 0 && (
              <p>
                <span className="label text-secondary">You are owed </span>
                <span className="readout__value glow-green">{formatAmount(t.owed, currency)}</span>
              </p>
            )}
            {t.owe > 0 && (
              <p>
                <span className="label text-secondary">You owe </span>
                <span className="readout__value glow-amber">{formatAmount(t.owe, currency)}</span>
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}
