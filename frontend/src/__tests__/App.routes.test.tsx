import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import App from '../App';

/*
 * Only the route table is under test: every page is a stub naming itself, and
 * the providers and shell pass their children through.
 */
const { passthrough, page } = vi.hoisted(() => ({
    passthrough: ({ children }: { children: ReactNode }) => <>{children}</>,
    page: (name: string) => ({ default: () => <div>{name} page</div> }),
}));

vi.mock('../AuthContext', () => ({
    AuthProvider: passthrough,
    useAuth: () => ({ user: { id: 1 }, loading: false }),
}));
vi.mock('../ThemeContext', () => ({ ThemeProvider: passthrough }));
vi.mock('../contexts/SyncContext', () => ({ SyncProvider: passthrough }));
vi.mock('../contexts/AppDataContext', () => ({ AppDataProvider: passthrough }));
vi.mock('../components/SyncStatusBar', () => ({ default: () => null }));
vi.mock('../layouts/AppShell', async () => {
    const { Outlet } = await import('react-router-dom');
    return { default: () => <Outlet /> };
});

vi.mock('../Login', () => page('Login'));
vi.mock('../Register', () => page('Register'));
vi.mock('../ForgotPasswordPage', () => page('ForgotPassword'));
vi.mock('../ResetPasswordPage', () => page('ResetPassword'));
vi.mock('../VerifyEmailPage', () => page('VerifyEmail'));
vi.mock('../routes/OverviewPage', () => page('Overview'));
vi.mock('../routes/GroupsPage', () => page('Groups'));
vi.mock('../routes/GroupPage', () => page('Group'));
vi.mock('../routes/GrouplessPage', () => page('Groupless'));
vi.mock('../routes/PersonPage', () => page('Person'));
vi.mock('../routes/SettleUpPage', () => page('SettleUp'));
vi.mock('../routes/TabBoardPage', () => page('TabBoard'));
vi.mock('../routes/TabsPage', () => page('Tabs'));
vi.mock('../routes/TabClosePage', () => page('TabClose'));
vi.mock('../routes/TabClaimPage', () => page('TabClaim'));
vi.mock('../routes/TabPassPage', () => page('TabPass'));
vi.mock('../routes/PublicGroupPage', () => page('PublicGroup'));
vi.mock('../routes/PeoplePage', () => page('People'));
vi.mock('../routes/ActivityPage', () => page('Activity'));
vi.mock('../routes/AccountSettingsPage', () => page('AccountSettings'));
vi.mock('../routes/HelpPage', () => page('Help'));

const renderAt = (path: string) => {
    window.history.pushState({}, '', path);
    render(<App />);
};

describe('App routes', () => {
    it('sends /groups/groupless to the group-less list, not a group', () => {
        renderAt('/groups/groupless');

        expect(screen.getByText('Groupless page')).toBeInTheDocument();
        expect(screen.queryByText('Group page')).not.toBeInTheDocument();
    });

    it('still sends a group id to the group', () => {
        renderAt('/groups/7');

        expect(screen.getByText('Group page')).toBeInTheDocument();
    });
});
