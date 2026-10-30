import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TabBoardDesktop from '../TabBoardDesktop';
import type { Tab } from '../../../types/tab';

const closed: Tab = {
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
    items: [{ id: 1, description: 'Bay', price: 5000, added_manually: false, claimed_by: [7] }],
    participants: [{ id: 7, display_name: 'Clinton', user_id: 18 }],
};

const renderBoard = (tab: Tab) =>
    render(
        <MemoryRouter>
            <TabBoardDesktop
                tab={tab}
                meId={7}
                shares={{ 7: 5000 }}
                claimed={5000}
                unclaimed={0}
                itemsTotal={5000}
                error={null}
                onToggleClaim={vi.fn()}
                onAddItem={vi.fn()}
                onDeleteItem={vi.fn()}
                onShowQr={vi.fn()}
                onEditAmounts={vi.fn()}
                onClose={vi.fn()}
            />
        </MemoryRouter>
    );

describe('TabBoardDesktop on a closed tab', () => {
    it('says the expense was deleted instead of claiming it is in balances', () => {
        renderBoard(closed);
        // The caption rides on the line under the name: "1 person here · Closed — …".
        expect(
            screen.getByText(/Closed — the expense it became has since been deleted\./)
        ).toBeInTheDocument();
        expect(screen.queryByText(/landed in everyone’s balances/)).not.toBeInTheDocument();
    });

    it('says a tab with its expense landed in balances', () => {
        renderBoard({ ...closed, expense_id: 334 });
        expect(
            screen.getByText(/Closed — this landed in everyone’s balances\./)
        ).toBeInTheDocument();
    });
});
