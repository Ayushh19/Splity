import { formatAmount, type FriendSummary } from '@splity/shared';
import { Plus, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Avatar, EmptyState, Money, TopBar, useToast } from '../components/ui';
import { errorMessage, useFriend, useFriends, useOpenDirect } from '../lib/api';
import { RemindButton } from './GroupDetail';

/** "owes you ₹500.00 · you owe ฿300.00" — one part per currency, never converted. */
function BalanceParts({ balances }: { balances: FriendSummary['balances'] }) {
  if (balances.length === 0) return <span className="text-muted">settled up</span>;
  return (
    <>
      {balances.map((b, i) => (
        <span key={b.currency} style={{ display: 'block' }}>
          {i > 0 && <span className="visually-hidden">, </span>}
          <Money netMinor={b.netMinor}>
            {b.netMinor > 0 ? 'owes you ' : 'you owe '}
            {formatAmount(Math.abs(b.netMinor), b.currency)}
          </Money>
        </span>
      ))}
    </>
  );
}

/** M2 Friends. */
export function Friends() {
  const friends = useFriends();
  return (
    <main className="screen screen--with-tabs">
      <TopBar title="Friends" />
      {friends.isPending && <div className="skeleton" style={{ height: 160 }} />}
      {friends.isError && (
        <p className="banner banner--error" role="alert">
          {errorMessage(friends.error)}
        </p>
      )}
      {friends.data &&
        (friends.data.length === 0 ? (
          <EmptyState
            icon={Users}
            line="> NO FRIENDS LOGGED"
            text="Everyone with an account you share a group with shows up here. Invite friends to a group to get started."
            action={
              <Link to="/groups/new" className="key key--primary">
                Create a group
              </Link>
            }
          />
        ) : (
          <ul className="list">
            {friends.data.map((f) => (
              <li key={f.userId}>
                <Link to={`/friends/${f.userId}`} className="row">
                  <Avatar name={f.displayName} photoUrl={f.photoUrl} />
                  <span className="row__main row__title">{f.displayName}</span>
                  <span className="row__end small">
                    <BalanceParts balances={f.balances} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}

/** F1 Friend detail. */
export function FriendDetail() {
  const { userId = '' } = useParams();
  const friend = useFriend(userId);
  const openDirect = useOpenDirect();
  const navigate = useNavigate();
  const toast = useToast();

  if (friend.isPending) {
    return (
      <main className="screen screen--with-tabs" aria-busy="true">
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </main>
    );
  }
  if (friend.isError) {
    return (
      <main className="screen screen--with-tabs">
        <TopBar back="/friends" title="Friend" />
        <p className="banner banner--error" role="alert">
          {errorMessage(friend.error)}
        </p>
      </main>
    );
  }

  const f = friend.data;

  async function addExpense() {
    try {
      const direct = await openDirect.mutateAsync(f.userId);
      void navigate(`/groups/${direct.id}/expenses/new`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="screen screen--with-tabs">
      <TopBar back="/friends" title={f.displayName} />

      <section className="readout" aria-label={`Your balance with ${f.displayName}`}>
        <p className="label readout__label">Overall with {f.displayName}</p>
        {f.balances.length === 0 ? (
          <p className="readout__value text-muted">ALL SQUARE</p>
        ) : (
          f.balances.map((b) => (
            <div key={b.currency}>
              <p className="label text-secondary">{b.netMinor > 0 ? `${f.displayName} owes you` : `You owe ${f.displayName}`}</p>
              <p className={`readout__value ${b.netMinor > 0 ? 'glow-green' : 'glow-amber'}`}>
                {formatAmount(Math.abs(b.netMinor), b.currency)}
              </p>
            </div>
          ))
        )}
      </section>

      <button type="button" className="key key--primary" disabled={openDirect.isPending} onClick={addExpense}>
        <Plus size={20} aria-hidden="true" />
        Add expense with {f.displayName}
      </button>

      <section>
        <h2 className="label section-label">By group</h2>
        <ul className="list">
          {f.groups.map((g) => {
            const theyOwe = g.netMinor > 0;
            return (
              <li key={g.groupId} className="row">
                <span className="row__main">
                  <Link to={`/groups/${g.groupId}${g.netMinor ? '?tab=balances' : ''}`} className="row__title" style={{ display: 'block', color: 'inherit' }}>
                    {g.name}
                  </Link>
                  <span className="small">
                    {g.netMinor === 0 ? (
                      <span className="text-muted">settled up</span>
                    ) : (
                      <Money netMinor={g.netMinor}>
                        {theyOwe ? 'owes you ' : 'you owe '}
                        {formatAmount(Math.abs(g.netMinor), g.currency)}
                      </Money>
                    )}
                  </span>
                </span>
                {g.netMinor !== 0 && (
                  <span className="row__end input-row">
                    {theyOwe && g.writable && <RemindButton groupId={g.groupId} member={g.theirMemberId} name={f.displayName} />}
                    <Link
                      to={`/groups/${g.groupId}/settle?from=${theyOwe ? g.theirMemberId : g.yourMemberId}&to=${theyOwe ? g.yourMemberId : g.theirMemberId}&amount=${Math.abs(g.netMinor)}`}
                      className={`key key--compact ${theyOwe ? 'key--secondary' : 'key--primary'}`}
                    >
                      {theyOwe ? 'Record' : 'Settle'}
                    </Link>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="field__help">Each group's balance follows its own "simplify debts" setting. Totals are per currency, never converted.</p>
      </section>
    </main>
  );
}
