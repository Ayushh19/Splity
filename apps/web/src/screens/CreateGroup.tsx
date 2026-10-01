import { displayName as displayNameSchema, groupName } from '@splity/shared';
import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { TopBar } from '../components/ui';
import { errorMessage, useCreateGroup, useMe } from '../lib/api';
import { CURRENCIES } from '../lib/format';

/** G1 Create group. */
export function CreateGroup() {
  const me = useMe();
  const create = useCreateGroup();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(me.data?.defaultCurrency ?? 'INR');
  const [draft, setDraft] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const nameCheck = groupName.safeParse(name);
  const nameError = submitted && !nameCheck.success ? nameCheck.error.issues[0]?.message : undefined;

  function addPerson() {
    const parsed = displayNameSchema.safeParse(draft);
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? 'Enter a name');
      return;
    }
    const taken = [me.data?.displayName ?? '', ...people].some((p) => p.toLowerCase() === parsed.data.toLowerCase());
    if (taken) {
      setDraftError(`${parsed.data} is already in the list`);
      return;
    }
    setPeople([...people, parsed.data]);
    setDraft('');
    setDraftError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!nameCheck.success) return;
    const group = await create.mutateAsync({ name: nameCheck.data, currency, placeholders: people });
    void navigate(`/groups/${group.id}`, { replace: true });
  }

  return (
    <main className="screen">
      <TopBar back="/" title="New group" />

      <form className="stack" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="label field__label" htmlFor="group-name">
            Group name
          </label>
          <input
            id="group-name"
            className="input"
            placeholder="Flat 302, Goa Trip…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'group-name-error' : undefined}
          />
          {nameError && (
            <p id="group-name-error" className="field__error">
              {nameError}
            </p>
          )}
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="currency">
            Currency
          </label>
          <select id="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="field__help">Every expense in this group is kept in {currency}.</p>
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="person">
            Who's in it?
          </label>
          <div className="input-row">
            <input
              id="person"
              className="input"
              placeholder="Friend's name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPerson();
                }
              }}
              aria-invalid={draftError ? true : undefined}
              aria-describedby="person-help"
            />
            <button type="button" className="key key--secondary" onClick={addPerson}>
              Add
            </button>
          </div>
          {draftError ? (
            <p id="person-help" className="field__error">
              {draftError}
            </p>
          ) : (
            <p id="person-help" className="field__help">
              Add friends by name now. They can claim their name later from the invite link.
            </p>
          )}
          {people.length > 0 && (
            <ul className="chips" aria-label="People added">
              {people.map((p) => (
                <li key={p} className="chip">
                  {p}
                  <button
                    type="button"
                    className="chip__remove"
                    aria-label={`Remove ${p}`}
                    onClick={() => setPeople(people.filter((x) => x !== p))}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {create.isError && (
          <p className="banner banner--error" role="alert">
            {errorMessage(create.error)}
          </p>
        )}

        <button type="submit" className="key key--primary key--block" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create group'}
        </button>
      </form>
    </main>
  );
}
