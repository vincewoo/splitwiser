import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import VerifyEmailPage from './VerifyEmailPage';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './ThemeContext';
import { SyncProvider } from './contexts/SyncContext';
import { AppDataProvider } from './contexts/AppDataContext';
import AppShell from './layouts/AppShell';
import OverviewPage from './routes/OverviewPage';
import GroupsPage from './routes/GroupsPage';
import GroupPage from './routes/GroupPage';
import PersonPage from './routes/PersonPage';
import SettleUpPage from './routes/SettleUpPage';
import TabBoardPage from './routes/TabBoardPage';
import TabsPage from './routes/TabsPage';
import TabClosePage from './routes/TabClosePage';
import TabClaimPage from './routes/TabClaimPage';
import TabPassPage from './routes/TabPassPage';
import PublicGroupPage from './routes/PublicGroupPage';
import PeoplePage from './routes/PeoplePage';
import ActivityPage from './routes/ActivityPage';
import AccountSettingsPage from './routes/AccountSettingsPage';
import HelpPage from './routes/HelpPage';
import SyncStatusBar from './components/SyncStatusBar';

const ProtectedRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-sw-bg">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sw-accent"></div>
        <p className="mt-4 text-sw-muted">Loading...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  return element;
};

/**
 * Wraps the redesigned shell in the auth guard and the shared data provider.
 * The provider sits inside the guard so it only fetches once there is a user.
 */
const ShellRoute = () => (
  <ProtectedRoute
    element={
      <AppDataProvider>
        <AppShell />
      </AppDataProvider>
    }
  />
);

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SyncProvider>
          <Router>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/verify-email/:token" element={<VerifyEmailPage />} />

              {/*
                * Protected routes render inside the shell, which stays mounted
                * across navigation — the rail and tab bar never unmount.
                */}
              <Route element={<ShellRoute />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/groups" element={<GroupsPage />} />
                <Route path="/groups/:groupId" element={<GroupPage />} />
                <Route path="/people" element={<PeoplePage />} />
                <Route path="/friends/:friendId" element={<PersonPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/settle" element={<SettleUpPage />} />
                <Route path="/tabs" element={<TabsPage />} />
                <Route path="/tabs/:tabId" element={<TabBoardPage />} />
                <Route path="/tabs/:tabId/close" element={<TabClosePage />} />
                <Route path="/account" element={<AccountSettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
              </Route>

              {/*
                * Public tab claim. No auth and no shell — the share token is
                * the only credential, and most people opening this have no
                * account at all.
                */}
              <Route path="/t/:shareToken" element={<TabClaimPage />} />

              {/*
                * Passing the host's phone round the table. Signed in like any
                * owner surface, but deliberately outside the shell: the device
                * is in somebody else's hands, and a tab bar would be an
                * invitation into the account.
                */}
              <Route
                path="/tabs/:tabId/pass"
                element={<ProtectedRoute element={<TabPassPage />} />}
              />

              {/* Public share link */}
              <Route path="/share/:shareLinkId" element={<PublicGroupPage />} />
            </Routes>
            <SyncStatusBar />
          </Router>
        </SyncProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
