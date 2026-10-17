import { useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { TypedLine } from '../components/TypedLine';
import { useAuthConfig } from '../lib/api';
import { safeNext } from '../lib/format';
import { authClient } from '../lib/auth-client';

const RESEND_AFTER_SECONDS = 60;
const CODE_LENGTH = 6;

const codeErrors: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check the email and try again.",
  OTP_EXPIRED: 'That code has expired. Send a new one below.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Send a new one below.',
};

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
  const queryClient = useQueryClient();
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // After a wrong code the input is enabled again: put the cursor back for the next try.
  useEffect(() => {
    if (codeError && !checking) codeInput.current?.focus();
  }, [codeError, checking]);

  async function submitCode(otp: string) {
    if (otp.length !== CODE_LENGTH || checking) return;
    setChecking(true);
    setCodeError(null);
    const { error } = await authClient.signIn.emailOtp({ email: props.email, otp });
    if (error) {
      setChecking(false);
      setCode('');
      setCodeError(
        error.status === 429
          ? 'Too many tries. Wait a minute and try again.'
          : (codeErrors[error.code ?? ''] ?? "Couldn't check the code. Check your connection and try again."),
      );
      return;
    }
    // Signed in: the sign-in route's guard sends the user on (to /welcome first if they're new).
    await queryClient.refetchQueries({ queryKey: ['me'] });
  }

  function onCodeChange(value: string) {
    // Accepts typing, autofill and pasting "482 913" or "Your code is 482913".
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (codeError) setCodeError(null);
    if (digits.length === CODE_LENGTH) void submitCode(digits);
  }

  return (
    <main className="screen screen--centered">
      <TypedLine text="> CHECK YOUR INBOX" className="h1 glow-green" />

      <div className="readout sent-to">
        <p className="label readout__label">SENT TO</p>
        <p className="sent-to__email">
          {/* Long addresses wrap after the @ rather than mid-word. */}
          {props.email.split('@')[0]}
          <wbr />@{props.email.split('@').slice(1).join('@')}
        </p>
      </div>

      <p>Type the 6-digit code from the email, or tap the link in it to sign in on this device.</p>

      {props.error && (
        <p className="banner banner--error" role="alert">
          {props.error}
        </p>
      )}

      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submitCode(code);
        }}
        noValidate
      >
        <div className="field">
          <label className="label field__label" htmlFor="code">
            Code
          </label>
          <div className={`code-input${codeError ? ' code-input--error' : ''}`}>
            <input
              ref={codeInput}
              id="code"
              className="code-input__field"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH + 8 /* room for pasted spaces/text */}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              disabled={checking}
              aria-invalid={codeError ? 'true' : undefined}
              aria-describedby="code-help"
              autoFocus
            />
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`code-input__cell${code[i] ? ' code-input__cell--filled' : ''}${
                  i === Math.min(code.length, CODE_LENGTH - 1) && !checking ? ' code-input__cell--active' : ''
                }`}
              >
                {code[i] ?? ''}
              </span>
            ))}
          </div>
          {codeError ? (
            <p className="field__error" id="code-help" role="alert">
              {codeError}
            </p>
          ) : (
            <p className="field__help" id="code-help">
              The code and link work once and expire in 10 minutes.
            </p>
          )}
        </div>
        <button type="submit" className="key key--primary key--block" disabled={checking || code.length !== CODE_LENGTH}>
          {checking ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="small text-muted">Not there? Check Spam and Promotions. It comes from Splity.</p>

      <div className="stack stack--sm">
        <button
          type="button"
          className="key key--secondary key--block"
          disabled={wait > 0 || props.sending}
          onClick={() => {
            props.onResend();
            setWait(RESEND_AFTER_SECONDS);
            setCode('');
            setCodeError(null);
          }}
        >
          {wait > 0 ? `Resend in ${wait}s` : props.sending ? 'Sending…' : 'Send a new code'}
        </button>
        <button type="button" className="key key--text" onClick={props.onChangeEmail}>
          Use a different email
        </button>
      </div>
    </main>
  );
}
