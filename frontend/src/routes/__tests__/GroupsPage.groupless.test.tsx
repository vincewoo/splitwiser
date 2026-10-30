import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GroupsPage from '../GroupsPage';

let groups: { id: number; name: string; icon: string | null }[] = [];

vi.mock('../../hooks/usePageTitle', () => ({ usePageTitle: () => {} }));
vi.mock('../../AddGroupModal', () => ({ default: () => null }));
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ groups, balances: [], refreshGroups: vi.fn() }),
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <GroupsPage />
        </MemoryRouter>
    );

describe('GroupsPage group-less link', () => {
    beforeEach(() => {
        groups = [];
    });

    it('links to group-less expenses below the groups', () => {
        groups = [{ id: 7, name: 'Ski cabin', icon: null }];
        renderPage();

        const link = screen.getByRole('link', { name: /Group-less expenses/ });
        expect(link).toHaveAttribute('href', '/groups/groupless');
    });

    it('links to them with no groups at all', () => {
        renderPage();

        expect(screen.getByText('No groups yet')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Group-less expenses/ })).toHaveAttribute(
            'href',
            '/groups/groupless'
        );
    });
});
