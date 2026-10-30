import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TabList from '../TabList';
import type { Tab } from '../../../types/tab';

const base: Tab = {
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
    closed_at: '2026-10-28T12:00:00',
    items: [{ id: 1, description: 'Bay', price: 5000, added_manually: false, claimed_by: [] }],
    participants: [{ id: 1, display_name: 'Clinton', user_id: 18 }],
};

const row = (tab: Tab) => {
    render(
        <MemoryRouter>
            <TabList tabs={[tab]} />
        </MemoryRouter>
    );
    return screen.getByRole('button', { name: /Golfzon/ });
};

describe('TabList closed rows', () => {
    it('says when it closed and that its expense is gone', () => {
        expect(row(base)).toHaveTextContent('Closed Oct 28 · 1 person · expense deleted');
    });

    it('says a tab with an expense is in your balances', () => {
        expect(row({ ...base, expense_id: 334 })).toHaveTextContent('in your balances');
    });

    it('says a tab closed to an off-app payer was settled outside the app', () => {
        expect(row({ ...base, payer_id: null })).toHaveTextContent('settled outside the app');
    });

    it('still says what is unclaimed on an open tab', () => {
        expect(row({ ...base, status: 'open', closed_at: null })).toHaveTextContent(
            '1 person · $50.00 still unclaimed'
        );
    });
});
