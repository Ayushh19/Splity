import { displayName as displayNameSchema, groupName, type GroupDetail, type MemberView } from '@splity/shared';
import { formatAmount } from '@splity/shared';
import { Archive, ArchiveRestore, Copy, GitMerge, LogOut, RotateCcw, Share2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Avatar, Badge, Sheet, Toggle, TopBar, useShareLink, useToast } from '../components/ui';
import {
  ApiError,
  errorMessage,
  useAddPlaceholder,
  useArchiveGroup,
  useMergeMember,
  useUnarchiveGroup,
  useGroup,
  useLeaveGroup,
  useMuteGroup,
  usePromoteMember,
  useRemoveMember,
  useResetInvite,
  useUndoClaim,
  useUpdateGroup,
} from '../lib/api';

/** G3 Group settings (+ G4 member actions as a bottom sheet). */
export function GroupSettings() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);

  if (group.isPending) return <main className="screen screen--with-tabs" aria-busy="true" />;
  if (group.isError) {
    return (
      <main className="screen screen--with-tabs">
        <TopBar back={`/groups/${groupId}`} title="Settings" />
        <p className="banner banner--error" role="alert">
          {errorMessage(group.error)}
        </p>
      </main>
    );
  }

  const g = group.data;
  const canWrite = g.you.status === 'active' && !g.archived;
  const isAdmin = canWrite && g.you.role === 'admin';

  return (
    <main className="screen screen--with-tabs">
      <TopBar back={`/groups/${g.id}`} title="Settings" />
      {!canWrite && (
        <p className="banner" role="status">
          {g.archived ? 'This group is archived and read-only.' : "You're no longer a member, so settings are read-only."}
        </p>
      )}
      {g.isDirect ? (
        // A 1-on-1 has exactly two people: no name, members, invite link, archiving or leaving.
        <MuteSetting group={g} />
      ) : (
        <>
          <RenameForm group={g} disabled={!canWrite} />
          <SimplifySetting group={g} disabled={!canWrite} />
          <MuteSetting group={g} />
          {g.inviteUrl && canWrite && <InviteLink group={g} isAdmin={isAdmin} />}
          <Members group={g} isAdmin={isAdmin} canWrite={canWrite} />
          {g.you.status === 'active' && g.you.role === 'admin' && <ArchiveSection group={g} />}
          {canWrite && <LeaveGroup group={g} />}
        </>
      )}
    </main>
  );
}

function RenameForm({ group, disabled }: { group: GroupDetail; disabled: boolean }) {
  const update = useUpdateGroup(group.id);
  const toast = useToast();
  const [name, setName] = useState(group.name);
  const check = groupName.safeParse(name);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!check.success || check.data === group.name) return;
    try {
      await update.mutateAsync({ name: check.data });
      toast('Group renamed');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <form className="field" onSubmit={onSubmit}>
      <label className="label field__label" htmlFor="rename">
        Group name
      </label>
      <div className="input-row">
        <input id="rename" className="input" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
        <button
          type="submit"
          className="key key--secondary"
          disabled={disabled || !check.success || check.data === group.name || update.isPending}
        >
          Save
        </button>
      </div>
      {!check.success && <p className="field__error">{check.error.issues[0]?.message}</p>}
    </form>
  );
}

function SimplifySetting({ group, disabled }: { group: GroupDetail; disabled: boolean }) {
  const update = useUpdateGroup(group.id);
  return (
    <section>
      <Toggle
        label={<span className="label">Simplify debts</span>}
        checked={group.simplifyDebts}
        disabled={disabled || update.isPending}
        onChange={(simplifyDebts) => update.mutate({ simplifyDebts })}
      />
      <p className="field__help">
        On: fewest payments to settle everyone. Off: who owes whom, expense by expense. Only changes the view, for
        everyone in the group.
      </p>
    </section>
  );
}

function MuteSetting({ group }: { group: GroupDetail }) {
  const mute = useMuteGroup(group.id);
  return (
    <section>
      <Toggle
        label={<span className="label">Mute notifications</span>}
        checked={group.you.muted}
        disabled={mute.isPending}
        onChange={(muted) => mute.mutate(muted)}
      />
      <p className="field__help">No pushes from this group on any of your devices. Reminders from friends still come through.</p>
    </section>
  );
}

function InviteLink({ group, isAdmin }: { group: GroupDetail; isAdmin: boolean }) {
  const share = useShareLink();
  const toast = useToast();
  const reset = useResetInvite(group.id);
  const [confirmReset, setConfirmReset] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(group.inviteUrl!);
      toast('Invite link copied');
    } catch {
      toast("Couldn't copy the link. Long-press it to copy.", 'error');
    }
  }

  return (
    <section>
      <h2 className="label section-label">Invite link</h2>
      <div className="copy-field">
        <span className="copy-field__value">{group.inviteUrl}</span>
        <button type="button" className="icon-button" aria-label="Copy invite link" onClick={copy}>
          <Copy size={20} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Share invite link" onClick={() => share(group.inviteUrl!, group.name)}>
          <Share2 size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="field__help">Anyone with this link can join and claim a placeholder.</p>
      {isAdmin && (
        <button type="button" className="key key--text" onClick={() => setConfirmReset(true)}>
          <RotateCcw size={18} aria-hidden="true" />
          Reset link
        </button>
      )}
      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} label="Reset invite link">
        <div className="stack">
          <h2 className="h1">Reset the link?</h2>
          <p>The current link stops working immediately. Anyone who hasn't joined yet will need the new one.</p>
          <button
            type="button"
            className="key key--danger key--block"
            disabled={reset.isPending}
            onClick={async () => {
              try {
                await reset.mutateAsync();
                toast('New invite link ready');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
              setConfirmReset(false);
            }}
          >
            Reset link
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setConfirmReset(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}

function Members({ group, isAdmin, canWrite }: { group: GroupDetail; isAdmin: boolean; canWrite: boolean }) {
  const add = useAddPlaceholder(group.id);
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<MemberView | null>(null);
  const check = displayNameSchema.safeParse(draft);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!check.success) return;
    try {
      await add.mutateAsync({ displayName: check.data });
      setDraft('');
      toast(`${check.data} added`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <section>
      <h2 className="label section-label">Members</h2>
      <ul className="list">
        {group.members.map((m) => {
          const content = (
            <>
              <Avatar name={m.displayName} photoUrl={m.photoUrl} />
              <span className="row__main">
                <span className="row__title" style={{ display: 'block' }}>
                  {m.displayName}
                  {m.isYou && <span className="text-muted"> (you)</span>}
                </span>
                <span className="chips">
                  {m.role === 'admin' && <Badge tone="beige">Admin</Badge>}
                  {m.isPlaceholder && <Badge>Placeholder</Badge>}
                  {m.status === 'removed' && <Badge>Removed</Badge>}
                </span>
              </span>
            </>
          );
          const actionable = isAdmin && !m.isYou && m.status === 'active';
          return (
            <li key={m.id}>
              {actionable ? (
                <button type="button" className="row" onClick={() => setSelected(m)} aria-label={`Manage ${m.displayName}`}>
                  {content}
                </button>
              ) : (
                <div className={`row${m.status === 'removed' ? ' row--muted' : ''}`}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>

      {canWrite && (
        <form className="field" onSubmit={onAdd} style={{ marginTop: 'var(--space-lg)' }}>
          <label className="label field__label" htmlFor="add-person">
            Add someone by name
          </label>
          <div className="input-row">
            <input id="add-person" className="input" placeholder="Friend's name" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="key key--secondary" disabled={!check.success || add.isPending}>
              Add
            </button>
          </div>
        </form>
      )}

      <MemberSheet group={group} member={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function MemberSheet({ group, member, onClose }: { group: GroupDetail; member: MemberView | null; onClose: () => void }) {
  const promote = usePromoteMember(group.id);
  const undoClaim = useUndoClaim(group.id);
  const remove = useRemoveMember(group.id);
  const merge = useMergeMember(group.id);
  const toast = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeInto, setMergeInto] = useState<string | null>(null);
  const busy = promote.isPending || undoClaim.isPending || remove.isPending || merge.isPending;

  const close = () => {
    setConfirmRemove(false);
    setMerging(false);
    setMergeInto(null);
    onClose();
  };
  const run = async (action: Promise<unknown>, done: string) => {
    try {
      await action;
      toast(done);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
    close();
  };

  if (!member) return null;
  const willDelete = member.isPlaceholder && !member.hasHistory;
  const mergeTargets = group.members.filter((m) => !m.isPlaceholder && m.status !== 'merged' && m.id !== member.id);
  const target = mergeTargets.find((m) => m.id === mergeInto);

  return (
    <Sheet open onClose={close} label={`Manage ${member.displayName}`}>
      {merging ? (
        <div className="stack">
          <h2 className="h1">Merge "{member.displayName}" into…</h2>
          <p className="small text-muted">
            Use this when the same person ended up twice. Everything of "{member.displayName}" moves to the person you pick; totals
            don't change.
          </p>
          <div role="radiogroup" aria-label="Merge into">
            {mergeTargets.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mergeInto === m.id} className="row" onClick={() => setMergeInto(m.id)}>
                <span className={`led ${mergeInto === m.id ? 'led--green' : ''}`} aria-hidden="true" />
                <span className="row__main row__title">
                  {m.displayName}
                  {m.isYou && <span className="text-muted"> (you)</span>}
                </span>
              </button>
            ))}
          </div>
          {target && (
            <p className="banner">
              {member.hasHistory
                ? `"${member.displayName}"'s expenses and payments become ${target.displayName}'s. Where both are on the same expense their shares are added together, and any payment between them is deleted. This can't be undone.`
                : `"${member.displayName}" isn't in any expense yet, so this just removes the duplicate.`}
            </p>
          )}
          <button
            type="button"
            className="key key--primary key--block"
            disabled={!target || busy}
            onClick={() => run(merge.mutateAsync({ memberId: member.id, intoMemberId: target!.id }), `Merged into ${target!.displayName}`)}
          >
            Merge
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setMerging(false)}>
            Back
          </button>
        </div>
      ) : confirmRemove ? (
        <div className="stack">
          <h2 className="h1">Remove {member.displayName}?</h2>
          <p>
            {willDelete
              ? `${member.displayName} isn't in any expense yet, so they'll be deleted from the group.`
              : `${member.displayName} stays visible as "removed" so past expenses and any balance still add up. They can rejoin with the invite link.`}
          </p>
          <button type="button" className="key key--danger key--block" disabled={busy} onClick={() => run(remove.mutateAsync(member.id), `${member.displayName} removed`)}>
            Remove
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="stack">
          <h2 className="h1">{member.displayName}</h2>
          {!member.isPlaceholder && member.role !== 'admin' && (
            <button type="button" className="key key--secondary key--block" disabled={busy} onClick={() => run(promote.mutateAsync(member.id), `${member.displayName} is now an admin`)}>
              Make admin
            </button>
          )}
          {member.isPlaceholder && mergeTargets.length > 0 && (
            <button type="button" className="key key--secondary key--block" disabled={busy} onClick={() => setMerging(true)}>
              <GitMerge size={18} aria-hidden="true" /> Merge into…
            </button>
          )}
          {member.claimed && member.role !== 'admin' && (
            <button type="button" className="key key--secondary key--block" disabled={busy} onClick={() => run(undoClaim.mutateAsync(member.id), 'Claim undone')}>
              Undo claim
            </button>
          )}
          <button type="button" className="key key--danger key--block" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove from group
          </button>
        </div>
      )}
    </Sheet>
  );
}

function ArchiveSection({ group }: { group: GroupDetail }) {
  const archive = useArchiveGroup(group.id);
  const unarchive = useUnarchiveGroup(group.id);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const names = new Map(group.members.map((m) => [m.id, m.displayName]));
  const unsettled =
    archive.error instanceof ApiError && archive.error.body?.error === 'nonzero_balance'
      ? ((archive.error.body as unknown as { unsettled: { memberId: string; netMinor: number }[] }).unsettled ?? [])
      : [];

  if (group.archived) {
    return (
      <section>
        <button
          type="button"
          className="key key--secondary key--block"
          disabled={unarchive.isPending}
          onClick={async () => {
            try {
              await unarchive.mutateAsync();
              toast('Group unarchived');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        >
          <ArchiveRestore size={18} aria-hidden="true" /> Unarchive group
        </button>
        <p className="field__help">Makes the group editable again for everyone.</p>
      </section>
    );
  }

  return (
    <section>
      <button type="button" className="key key--text" onClick={() => setOpen(true)}>
        <Archive size={18} aria-hidden="true" /> Archive group
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          archive.reset();
        }}
        label="Archive group"
      >
        <div className="stack">
          <h2 className="h1">Archive {group.name}?</h2>
          <p>
            The group becomes read-only for everyone and moves to History. Nothing is deleted, and an admin can unarchive it later.
            Everyone needs to be settled up first.
          </p>
          {unsettled.length > 0 && (
            <div className="banner" role="alert">
              <p>Not settled yet:</p>
              <ul className="log">
                {unsettled.map((u) => (
                  <li key={u.memberId} className="log__line" style={{ gridTemplateColumns: '1fr auto' }}>
                    <span>{names.get(u.memberId) ?? 'Former member'}</span>
                    <span className={`amount ${u.netMinor > 0 ? 'money--owed' : 'money--owe'}`}>
                      {u.netMinor > 0 ? '+' : '\u2212'}
                      {formatAmount(Math.abs(u.netMinor), group.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {archive.isError && unsettled.length === 0 && (
            <p className="banner banner--error" role="alert">
              {errorMessage(archive.error)}
            </p>
          )}
          <button
            type="button"
            className="key key--primary key--block"
            disabled={archive.isPending}
            onClick={async () => {
              try {
                await archive.mutateAsync();
                toast(`${group.name} archived`);
                setOpen(false);
              } catch {
                // shown in the sheet
              }
            }}
          >
            Archive
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}

function LeaveGroup({ group }: { group: GroupDetail }) {
  const leave = useLeaveGroup(group.id);
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button type="button" className="key key--text" style={{ color: 'var(--danger-text)' }} onClick={() => setOpen(true)}>
        <LogOut size={18} aria-hidden="true" />
        Leave group
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Leave group">
        <div className="stack">
          <h2 className="h1">Leave {group.name}?</h2>
          <p>You can only leave when you're settled up. You can rejoin later with the invite link.</p>
          {leave.isError && (
            <p className="banner banner--error" role="alert">
              {errorMessage(leave.error)}
            </p>
          )}
          <button
            type="button"
            className="key key--danger key--block"
            disabled={leave.isPending}
            onClick={async () => {
              try {
                await leave.mutateAsync();
                toast(`You left ${group.name}`);
                void navigate('/', { replace: true });
              } catch {
                // shown in the sheet
              }
            }}
          >
            Leave group
          </button>
          <button type="button" className="key key--secondary key--block" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}
