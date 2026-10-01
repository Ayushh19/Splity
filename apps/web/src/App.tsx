import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Activity, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ui';
import { useMe } from './lib/api';
import { safeNext } from './lib/format';
import { Account } from './screens/Account';
import { ComingSoon } from './screens/ComingSoon';
import { CreateGroup } from './screens/CreateGroup';
import { AddExpense, EditExpense, ExpenseDetail, PickGroup } from './screens/ExpenseScreens';
import { EditSettlement, SettlementDetail, SettleUp } from './screens/SettleScreens';
import { GroupDetail } from './screens/GroupDetail';
import { GroupSettings } from './screens/GroupSettings';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { SignIn } from './screens/SignIn';
import { Welcome } from './screens/Welcome';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/sign-in" element={<Gate when="signed-out"><SignIn /></Gate>} />
            <Route path="/welcome" element={<Gate when="signed-in"><Welcome /></Gate>} />
            {/* Works signed in or out: the preview is public, joining needs a session. */}
            <Route path="/join/:token" element={<Join />} />

            <Route element={<Gate when="signed-in" requireName><AppShell /></Gate>}>
              <Route index element={<Home />} />
              <Route path="groups/:groupId" element={<GroupDetail />} />
              <Route path="groups/:groupId/settings" element={<GroupSettings />} />
              <Route path="groups/:groupId/expenses/:expenseId" element={<ExpenseDetail />} />
              <Route path="groups/:groupId/settlements/:settlementId" element={<SettlementDetail />} />
              <Route path="friends" element={<ComingSoon title="Friends" icon={Users} line="> NO FRIENDS LOGGED" text="Everyone you share a group with shows up here once expenses arrive." />} />
              <Route path="activity" element={<ComingSoon title="Activity" icon={Activity} line="> LOG EMPTY" text="A feed across all your groups is coming. Each group's activity is in its Activity tab." />} />
              <Route path="add" element={<PickGroup />} />
              <Route path="account" element={<Account />} />
            </Route>
            {/* Full-screen forms: no tab bar. */}
            <Route path="/groups/new" element={<Gate when="signed-in" requireName><CreateGroup /></Gate>} />
            <Route path="/groups/:groupId/expenses/new" element={<Gate when="signed-in" requireName><AddExpense /></Gate>} />
            <Route path="/groups/:groupId/expenses/:expenseId/edit" element={<Gate when="signed-in" requireName><EditExpense /></Gate>} />
            <Route path="/groups/:groupId/settle" element={<Gate when="signed-in" requireName><SettleUp /></Gate>} />
            <Route path="/groups/:groupId/settlements/:settlementId/edit" element={<Gate when="signed-in" requireName><EditSettlement /></Gate>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * Route guard: signed-out users go to sign-in (and come back afterwards), new users
 * pick a name first, signed-in users skip the sign-in screen.
 */
function Gate({ when, requireName, children }: { when: 'signed-in' | 'signed-out'; requireName?: boolean; children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  const [params] = useSearchParams();

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
  const here = encodeURIComponent(location.pathname + location.search);
  if (when === 'signed-out') return user ? <Navigate to={safeNext(params.get('next')) ?? '/'} replace /> : children;
  if (!user) return <Navigate to={`/sign-in?next=${here}`} replace />;
  if (requireName && !user.displayName) return <Navigate to={`/welcome?next=${here}`} replace />;
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
