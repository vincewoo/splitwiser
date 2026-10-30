import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TabBoardPage from '../TabBoardPage';
import { tabsApi } from '../../services/api';

vi.mock('../../services/api', () => ({ tabsApi: { getById: vi.fn() } }));
vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: { id: 18, email: 'c@example.com', full_name: 'Clinton' } }),
}));
vi.mock('../../hooks/useMediaQuery', () => ({ useIsDesktop: () => false }));

const closed = (over: Record<string, unknown>) => ({
    id: 12,
    name: 'Golfzon',
    currency: 'USD',
    status: 'closed',
    tax: 0,
    tip: 0,
    total: 5000,
    created_by_id: 18,
    payer_id: 18,
    expense_id: null,
    share_token: 'tok',
    token_expires_at: null,
    items: [{ id: 1, description: 'Bay', price: 5000, added_manually: false, claimed_by: [7] }],
    participants: [{ id: 7, display_name: 'Clinton', user_id: 18 }],
    ...over,
});

const renderBoard = () =>
    render(
        <MemoryRouter initialEntries={['/tabs/12']}>
            <Routes>
                <Route path="/tabs/:tabId" element={<TabBoardPage />} />
            </Routes>
        </MemoryRouter>
    );

describe('TabBoardPage footer on a closed tab', () => {
    it('says the expense was deleted', async () => {
        vi.mocked(tabsApi.getById).mockResolvedValue(closed({}));
        renderBoard();
        expect(
            await screen.findByText('Closed — the expense it became has since been deleted.')
        ).toBeInTheDocument();
    });

    it('says an off-app close is settled outside the app', async () => {
        vi.mocked(tabsApi.getById).mockResolvedValue(closed({ payer_id: null }));
        renderBoard();
        expect(
            await screen.findByText('Closed — everyone settles with whoever paid, outside the app.')
        ).toBeInTheDocument();
    });
});
