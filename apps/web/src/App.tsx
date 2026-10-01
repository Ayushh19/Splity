import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useMe } from './lib/api';
import { Home } from './screens/Home';
import { SignIn } from './screens/SignIn';
import { Welcome } from './screens/Welcome';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/sign-in"
            element={
              <Gate when="signed-out">
                <SignIn />
              </Gate>
            }
          />
          <Route
            path="/welcome"
            element={
              <Gate when="signed-in">
                <Welcome />
              </Gate>
            }
          />
          <Route
            path="/"
            element={
              <Gate when="signed-in" requireName>
                <Home />
              </Gate>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** Route guard: sends people to sign-in, to the name step, or home, depending on their session. */
function Gate({ when, requireName, children }: { when: 'signed-in' | 'signed-out'; requireName?: boolean; children: ReactNode }) {
  const me = useMe();

  if (me.isPending) return <LoadingScreen />;
  if (me.isError) {
    return (
      <main className="screen screen--centered">
        <p className="banner banner--error" role="alert">
          Can't reach Splity right now. Check your connection and reload.
        </p>
      </main>
    );
  }

  const user = me.data;
  if (when === 'signed-out') return user ? <Navigate to="/" replace /> : children;
  if (!user) return <Navigate to="/sign-in" replace />;
  if (requireName && !user.displayName) return <Navigate to="/welcome" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <main className="screen" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 32, width: '40%' }} />
      <div className="skeleton" style={{ height: 120 }} />
      <div className="skeleton" style={{ height: 48 }} />
    </main>
  );
}
