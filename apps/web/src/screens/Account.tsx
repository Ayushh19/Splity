import { profileUpdate, type Profile } from '@splity/shared';
import { useQueryClient } from '@tanstack/react-query';
import { formatAmount } from '@splity/shared';
import { Archive, BellRing, LogOut, Share, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Sheet, Toggle, TopBar, useToast } from '../components/ui';
import { errorMessage, useAuthConfig, useDeleteAccount, useDeletionCheck, useMe, useUpdateProfile } from '../lib/api';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { authClient } from '../lib/auth-client';
import { CURRENCIES } from '../lib/format';

/** M4 Account. */
export function Account() {
  const me = useMe();
  const queryClient = useQueryClient();

  async function signOut() {
    // This device must stop getting the account's notifications.
    await disablePush().catch(() => undefined);
    await authClient.signOut();
    queryClient.clear();
    queryClient.setQueryData(['me'], null);
  }

  return (
    <main className="screen screen--with-tabs">
      <TopBar title="Account" />
      {me.data && <ProfileForm profile={me.data} />}
      <Notifications />
      <Link to="/history" className="row">
        <Archive size={20} aria-hidden="true" />
        <span className="row__main row__title">History</span>
        <span className="text-muted">›</span>
      </Link>
      <button type="button" className="key key--secondary" onClick={signOut}>
        <LogOut size={20} aria-hidden="true" />
        Sign out
      </button>
      <DeleteAccount />
    </main>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const [name, setName] = useState(profile.displayName);
  const [upi, setUpi] = useState(profile.upiId ?? '');
  const [currency, setCurrency] = useState(profile.defaultCurrency);

  const parsed = profileUpdate.safeParse({ displayName: name, upiId: upi.trim() || null, defaultCurrency: currency });
  const issue = (field: string) =>
    parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === field)?.message;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!parsed.success) return;
    try {
      await update.mutateAsync(parsed.data);
      toast('Profile saved');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      <p className="small text-muted">Signed in as {profile.email}</p>
      <div className="field">
        <label className="label field__label" htmlFor="acct-name">
          Your name
        </label>
        <input id="acct-name" className="input" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={issue('displayName') ? true : undefined} />
        {issue('displayName') && <p className="field__error">{issue('displayName')}</p>}
      </div>
      <div className="field">
        <label className="label field__label" htmlFor="acct-upi">
          UPI ID
        </label>
        <input
          id="acct-upi"
          className="input"
          placeholder="name@bank"
          autoCapitalize="none"
          autoCorrect="off"
          value={upi}
          onChange={(e) => setUpi(e.target.value)}
          aria-invalid={issue('upiId') ? true : undefined}
        />
        {issue('upiId') ? (
          <p className="field__error">{issue('upiId')}</p>
        ) : (
          <p className="field__help">Optional. Friends get a "Pay via UPI" button when they settle up with you.</p>
        )}
      </div>
      <div className="field">
        <label className="label field__label" htmlFor="acct-currency">
          Default currency
        </label>
        <select id="acct-currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="field__help">Used for new groups and 1-on-1 expenses.</p>
      </div>
      <button type="submit" className="key key--primary key--block" disabled={!parsed.success || update.isPending}>
        {update.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function Notifications() {
  const config = useAuthConfig();
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  if (!config.data?.push || state === null) return null;

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      const next = on ? await enablePush(config.data!.vapidPublicKey!) : await disablePush();
      setState(next);
      if (on && next === 'on') toast('Notifications on for this device');
      if (on && next === 'denied') toast('Notifications are blocked in your browser settings', 'error');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change notifications', 'error');
    }
    setBusy(false);
  }

  return (
    <section className="stack stack--sm" aria-labelledby="notif-label">
      <h2 id="notif-label" className="label section-label">
        <BellRing size={16} aria-hidden="true" /> Notifications
      </h2>
      {state === 'needs-install' ? (
        <p className="banner">
          To get notifications on iPhone, tap <Share size={14} aria-label="Share" /> then <strong>Add to Home Screen</strong>, and
          open Splity from there.
        </p>
      ) : state === 'unsupported' ? (
        <p className="text-muted small">This browser can't show notifications.</p>
      ) : state === 'denied' ? (
        <p className="banner">Notifications are blocked for Splity. Allow them in your browser or phone settings, then come back.</p>
      ) : (
        <Toggle label="Push notifications on this device" checked={state === 'on'} disabled={busy} onChange={toggle} />
      )}
      <p className="field__help">
        You'll hear about expenses and payments you're part of, and reminders. Mute a noisy group in its settings.
      </p>
    </section>
  );
}

/** Delete account: blocked while any balance is non-zero; typed confirmation (SPEC › Accounts). */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const check = useDeletionCheck(open);
  const del = useDeleteAccount();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  async function onDelete() {
    try {
      await disablePush().catch(() => undefined);
      await del.mutateAsync();
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
      toast('Your account was deleted');
      void navigate('/sign-in', { replace: true });
    } catch {
      void check.refetch();
    }
  }

  return (
    <section>
      <button type="button" className="key key--text" style={{ color: 'var(--danger-text)' }} onClick={() => setOpen(true)}>
        <Trash2 size={18} aria-hidden="true" /> Delete account
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setTyped('');
        }}
        label="Delete account"
      >
        <div className="stack">
          <h2 className="h1">Delete your account?</h2>
          {check.isPending ? (
            <div className="skeleton" style={{ height: 80 }} />
          ) : check.data && !check.data.canDelete ? (
            <>
              <p>Settle up first. You still have a balance in:</p>
              <ul className="list">
                {check.data.blockers.map((b) => (
                  <li key={b.groupId}>
                    <Link to={`/groups/${b.groupId}?tab=balances`} className="row" onClick={() => setOpen(false)}>
                      <span className="row__main row__title">{b.isDirect ? '1-on-1' : b.name}</span>
                      <span className={`amount ${b.netMinor > 0 ? 'money--owed' : 'money--owe'}`}>
                        {b.netMinor > 0 ? 'owed ' : 'you owe '}
                        {formatAmount(Math.abs(b.netMinor), b.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>
                Your name, email, photo, UPI ID and devices are removed. Past expenses stay so everyone else's balances still add up,
                and you'll show as "Deleted user". This can't be undone.
              </p>
              <div className="field">
                <label className="label field__label" htmlFor="confirm-delete">
                  Type DELETE to confirm
                </label>
                <input id="confirm-delete" className="input" autoCapitalize="characters" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
              {del.isError && (
                <p className="banner banner--error" role="alert">
                  {errorMessage(del.error)}
                </p>
              )}
              <button type="button" className="key key--danger key--block" disabled={typed !== 'DELETE' || del.isPending} onClick={onDelete}>
                Delete my account
              </button>
            </>
          )}
          <button type="button" className="key key--secondary key--block" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </section>
  );
}
