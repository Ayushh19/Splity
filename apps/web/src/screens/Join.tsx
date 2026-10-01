import { Check, Link2Off } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { TypedLine } from '../components/TypedLine';
import { EmptyState } from '../components/ui';
import { ApiError, errorMessage, useInvite, useJoinInvite, useMe } from '../lib/api';

const NEW_MEMBER = 'new';

/** E3 Invite landing: preview signed out; pick your placeholder or join as new once signed in. */
export function Join() {
  const { token = '' } = useParams();
  const me = useMe();
  const invite = useInvite(token);
  const join = useJoinInvite(token);
  const navigate = useNavigate();
  const [choice, setChoice] = useState<string | null>(null);
  const here = `/join/${token}`;

  if (me.isPending || invite.isPending) {
    return (
      <main className="screen" aria-busy="true">
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </main>
    );
  }

  if (invite.isError) {
    const gone = invite.error instanceof ApiError && invite.error.status === 404;
    return (
      <main className="screen screen--centered">
        <EmptyState
          icon={Link2Off}
          line={gone ? '> LINK EXPIRED' : '> NO SIGNAL'}
          text={gone ? 'This invite link is no longer valid. Ask someone in the group for a new one.' : errorMessage(invite.error)}
          action={
            <Link to="/" className="key key--secondary">
              Go home
            </Link>
          }
        />
      </main>
    );
  }

  const preview = invite.data;
  const user = me.data;

  if (user && !user.displayName) return <Navigate to={`/welcome?next=${encodeURIComponent(here)}`} replace />;

  if (preview.alreadyMember) {
    return (
      <main className="screen screen--centered">
        <TypedLine text="> ALREADY IN" className="label glow-green" />
        <h1 className="h1">You're already in {preview.groupName}</h1>
        <Link to={`/groups/${preview.groupId}`} className="key key--primary key--block">
          Open group
        </Link>
      </main>
    );
  }

  async function onJoin() {
    if (!choice) return;
    try {
      const group = await join.mutateAsync(choice === NEW_MEMBER ? {} : { claimMemberId: choice });
      void navigate(`/groups/${group.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.body?.error === 'already_member') void navigate(`/groups/${preview.groupId}`, { replace: true });
    }
  }

  return (
    <main className="screen">
      <TypedLine text="> INCOMING INVITE" className="label glow-green" />
      <div className="stack stack--sm">
        <h1 className="h1">{preview.groupName}</h1>
        <p className="text-muted">
          {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
        </p>
      </div>

      {!user ? (
        <>
          {preview.unclaimed.length > 0 && (
            <section>
              <h2 className="label section-label">Waiting to be claimed</h2>
              <p>{preview.unclaimed.map((u) => u.displayName).join(', ')}</p>
            </section>
          )}
          <p>Sign in to join. If one of the names above is you, you'll pick it next.</p>
          <Link to={`/sign-in?next=${encodeURIComponent(here)}`} className="key key--primary key--block">
            Sign in to join
          </Link>
        </>
      ) : (
        <>
          <fieldset className="stack stack--sm" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="label section-label">Which one is you?</legend>
            {preview.unclaimed.map((u) => (
              <ChoiceRow key={u.id} label={`I'm ${u.displayName}`} selected={choice === u.id} onSelect={() => setChoice(u.id)} />
            ))}
            <ChoiceRow
              label={preview.unclaimed.length ? "I'm not on this list" : `Join as ${user.displayName}`}
              hint={preview.unclaimed.length ? `Join as ${user.displayName}` : undefined}
              selected={choice === NEW_MEMBER}
              onSelect={() => setChoice(NEW_MEMBER)}
            />
          </fieldset>

          {join.isError && (
            <p className="banner banner--error" role="alert">
              {errorMessage(join.error)}
            </p>
          )}

          <button type="button" className="key key--primary key--block" disabled={!choice || join.isPending} onClick={onJoin}>
            {join.isPending ? 'Joining…' : 'Join group'}
          </button>
          <p className="small text-muted">Picking a name links its past expenses to your account. An admin can undo a wrong pick.</p>
        </>
      )}
    </main>
  );
}

function ChoiceRow({ label, hint, selected, onSelect }: { label: string; hint?: string | undefined; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="row" onClick={onSelect}>
      <span className={`led ${selected ? 'led--green' : ''}`} aria-hidden="true" />
      <span className="row__main">
        <span className={`row__title ${selected ? 'glow-green' : ''}`} style={{ display: 'block' }}>
          {label}
        </span>
        {hint && <span className="small text-muted">{hint}</span>}
      </span>
      {selected && <Check size={20} className="glow-green" aria-hidden="true" />}
    </button>
  );
}
