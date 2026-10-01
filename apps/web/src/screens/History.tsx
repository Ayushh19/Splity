import { Archive } from 'lucide-react';
import { Link } from 'react-router';
import { Avatar, EmptyState, TopBar } from '../components/ui';
import { errorMessage, useArchivedGroups } from '../lib/api';

/** H1 History: archived groups, read-only. */
export function History() {
  const groups = useArchivedGroups();
  return (
    <main className="screen screen--with-tabs">
      <TopBar back="/account" title="History" />
      {groups.isPending && <div className="skeleton" style={{ height: 120 }} />}
      {groups.isError && (
        <p className="banner banner--error" role="alert">
          {errorMessage(groups.error)}
        </p>
      )}
      {groups.data &&
        (groups.data.length === 0 ? (
          <EmptyState icon={Archive} line="> ARCHIVE EMPTY" text="Groups land here when an admin archives them after everyone's settled up." />
        ) : (
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
                      {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'} · {g.currency}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}
