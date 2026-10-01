import { Mail } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { TypedLine } from '../components/TypedLine';
import { useAuthConfig } from '../lib/api';
import { safeNext } from '../lib/format';
import { authClient } from '../lib/auth-client';

const RESEND_AFTER_SECONDS = 60;

const signInErrors: Record<string, string> = {
  EXPIRED_TOKEN: 'That link has expired. Request a new one below.',
  INVALID_TOKEN: 'That link was already used or is invalid. Request a new one below.',
  access_denied: 'Google sign-in was cancelled.',
  state_mismatch: 'Google sign-in timed out or was opened in another browser. Try again.',
};

/** E1 Sign in + E2 Magic link sent (docs/SCREENS.md). */
export function SignIn() {
  const [params] = useSearchParams();
  const config = useAuthConfig();
  // Where to go after signing in (e.g. back to an invite link), and the same for brand-new users via /welcome.
  const next = safeNext(params.get('next'));
  const callbackURL = next ?? '/';
  const newUserCallbackURL = next ? `/welcome?next=${encodeURIComponent(next)}` : '/welcome';
  const errorCallbackURL = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => {
    const code = params.get('error');
    return code ? (signInErrors[code] ?? 'Sign-in failed. Try again.') : null;
  });
  const [sending, setSending] = useState(false);

  async function sendLink(to: string) {
    setSending(true);
    setError(null);
    const { error } = await authClient.signIn.magicLink({
      email: to,
      callbackURL,
      newUserCallbackURL,
      errorCallbackURL,
    });
    setSending(false);
    if (error) {
      setError(error.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'Could not send the link. Check the address and try again.');
      return;
    }
    setSentTo(to);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendLink(email.trim());
  }

  if (sentTo) {
    return (
      <LinkSent
        email={sentTo}
        sending={sending}
        error={error}
        onResend={() => sendLink(sentTo)}
        onChangeEmail={() => {
          setSentTo(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <main className="screen screen--centered">
      <div className="readout" aria-hidden="true">
        <p className="label readout__label">SYS // SPLITY v1</p>
        <p className="readout__value glow-green">SPLITY</p>
      </div>
      <div className="stack stack--sm">
        <h1 className="h1">Split it. Square it.</h1>
        <p className="text-muted">Shared expenses with your friends, kept exact to the paisa.</p>
      </div>

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
        </p>
      )}

      <div className="stack">
        {config.data?.google && (
          <>
            <button
              type="button"
              className="key key--primary key--block"
              onClick={() =>
                authClient.signIn.social({
                  provider: 'google',
                  callbackURL,
                  newUserCallbackURL,
                  errorCallbackURL,
                })
              }
            >
              Continue with Google
            </button>
            <p className="divider label">or</p>
          </>
        )}

        <form className="stack" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="label field__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className={`key key--block ${config.data?.google ? 'key--secondary' : 'key--primary'}`}
            disabled={sending || !/^\S+@\S+\.\S+$/.test(email.trim())}
          >
            <Mail size={20} aria-hidden="true" />
            {sending ? 'Sending…' : 'Email me a link'}
          </button>
        </form>
      </div>
    </main>
  );
}

function LinkSent(props: {
  email: string;
  sending: boolean;
  error: string | null;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  return (
    <main className="screen screen--centered">
      <TypedLine text="> CHECK YOUR INBOX" className="h1 glow-green" />
      <p>
        We sent a sign-in link to <strong className="text-secondary">{props.email}</strong>. It works once and
        expires in 10 minutes.
      </p>

      {props.error && (
        <p className="banner banner--error" role="alert">
          {props.error}
        </p>
      )}

      <div className="stack stack--sm">
        <button
          type="button"
          className="key key--secondary key--block"
          disabled={wait > 0 || props.sending}
          onClick={() => {
            props.onResend();
            setWait(RESEND_AFTER_SECONDS);
          }}
        >
          {wait > 0 ? `Resend in ${wait}s` : props.sending ? 'Sending…' : 'Resend link'}
        </button>
        <button type="button" className="key key--text" onClick={props.onChangeEmail}>
          Use a different email
        </button>
      </div>
    </main>
  );
}
