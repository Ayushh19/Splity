import { profileUpdate, type Profile } from '@splity/shared';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { TopBar, useToast } from '../components/ui';
import { errorMessage, useMe, useUpdateProfile } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { CURRENCIES } from '../lib/format';

/** M4 Account. */
export function Account() {
  const me = useMe();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    queryClient.setQueryData(['me'], null);
  }

  return (
    <main className="screen screen--with-tabs">
      <TopBar title="Account" />
      {me.data && <ProfileForm profile={me.data} />}
      <button type="button" className="key key--secondary" onClick={signOut}>
        <LogOut size={20} aria-hidden="true" />
        Sign out
      </button>
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
