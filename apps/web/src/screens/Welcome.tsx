import { displayName as displayNameSchema } from '@splity/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { TypedLine } from '../components/TypedLine';
import { useMe, useUpdateProfile } from '../lib/api';
import { safeNext } from '../lib/format';

/** First sign-in: ask for the name friends will see. Google users arrive with one pre-filled. */
export function Welcome() {
  const me = useMe();
  const update = useUpdateProfile();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState(me.data?.displayName ?? '');
  const [touched, setTouched] = useState(false);

  const parsed = displayNameSchema.safeParse(name);
  const error = touched && !parsed.success ? parsed.error.issues[0]?.message : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!parsed.success) return;
    await update.mutateAsync({ displayName: parsed.data });
    void navigate(safeNext(params.get('next')) ?? '/', { replace: true });
  }

  return (
    <main className="screen screen--centered">
      <TypedLine text="> NEW OPERATOR DETECTED" className="label glow-green" />
      <h1 className="h1">What should friends call you?</h1>

      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="label field__label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="input"
            autoComplete="name"
            placeholder="Priya"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'name-error' : 'name-help'}
          />
          {error ? (
            <p id="name-error" className="field__error">
              {error}
            </p>
          ) : (
            <p id="name-help" className="field__help">
              Shown in groups and on expenses. You can change it later.
            </p>
          )}
        </div>
        {update.isError && (
          <p className="banner banner--error" role="alert">
            Could not save your name. Try again.
          </p>
        )}
        <button type="submit" className="key key--primary key--block" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
