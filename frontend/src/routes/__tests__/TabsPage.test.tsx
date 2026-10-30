import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TabsPage from '../TabsPage';

const getAll = vi.fn();
vi.mock('../../services/api', () => ({
    tabsApi: { getAll: (...args: unknown[]) => getAll(...args) },
}));
vi.mock('../../contexts/AppDataContext', () => ({
    useAppData: () => ({ refreshGeneration: 0 }),
}));

const tab = (id: number, name: string, status: 'open' | 'closed') => ({
    id,
    name,
    currency: 'USD',
    status,
    tax: 0,
    tip: 0,
    total: 1000,
    created_by_id: 1,
    payer_id: 1,
    expense_id: null,
    closed_at: status === 'closed' ? '2026-10-28T20:45:00' : null,
    items: [],
    participants: [],
});

const renderPage = () =>
    render(
        <MemoryRouter>
            <TabsPage />
        </MemoryRouter>
    );

describe('TabsPage', () => {
    it('lists open tabs, then closed ones', async () => {
        getAll.mockResolvedValue([tab(14, 'Karaoke', 'open'), tab(12, 'Golfzon', 'closed')]);
        renderPage();

        expect(await screen.findByText('Golfzon')).toBeInTheDocument();
        const headings = screen.getAllByText(/^(Open|Closed)$/).map((el) => el.textContent);
        expect(headings).toEqual(['Open', 'Closed']);
        expect(screen.getByText('Karaoke')).toBeInTheDocument();
    });

    it('says it could not load rather than that there are no tabs', async () => {
        getAll.mockRejectedValue(new Error('offline'));
        renderPage();

        expect(await screen.findByText(/Couldn’t load your tabs/)).toBeInTheDocument();
        expect(screen.queryByText(/No tabs yet/)).not.toBeInTheDocument();
    });

    it('says so when there are no tabs', async () => {
        getAll.mockResolvedValue([]);
        renderPage();

        expect(await screen.findByText(/No tabs yet/)).toBeInTheDocument();
    });
});
