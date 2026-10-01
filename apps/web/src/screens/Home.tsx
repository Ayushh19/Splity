import { LogOut } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../lib/api';
import { authClient } from '../lib/auth-client';

/** M1 Home — placeholder until groups and balances exist. */
export function Home() {
  const me = useMe();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.setQueryData(['me'], null);
  }

  return (
    <main className="screen">
      <header className="stack stack--sm">
        <p className="label text-muted">Signed in as</p>
        <h1 className="h1">{me.data?.displayName}</h1>
      </header>

      <section className="readout" aria-label="Net balance">
        <p className="label readout__label">Net balance // {me.data?.defaultCurrency}</p>
        <p className="readout__value text-muted">ALL SQUARE</p>
      </section>

      <p className="text-muted">Groups and expenses arrive in the next build.</p>

      <button type="button" className="key key--secondary" onClick={signOut}>
        <LogOut size={20} aria-hidden="true" />
        Sign out
      </button>
    </main>
  );
}
