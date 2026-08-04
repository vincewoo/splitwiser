import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TabClaimPage from '../TabClaimPage';
import { publicTabsApi } from '../../services/api';

vi.mock('../../services/api', () => ({
    publicTabsApi: {
        get: vi.fn(),
        join: vi.fn(),
        rename: vi.fn(),
        claim: vi.fn(),
    },
}));

vi.mock('../../AuthContext', () => ({
    useAuth: () => ({ user: null, loading: false }),
}));

const SHARE_TOKEN = 'share-token';

/**
 * A tab with one 28.00 item, already claimed by Maya (participant 2) so there
 * is a share to hand over. No tax or tip, keeping the arithmetic obvious.
 */
const tab = (over: Record<string, unknown> = {}) => ({
    name: 'Bar Sol',
    currency: 'USD',
    status: 'open' as const,
    tax: 0,
    tip: 0,
    total: 2800,
    host_name: 'Vince Woo',
    host_venmo_username: 'vince-woo',
    items: [
        {
            id: 7,
            description: 'Pizza margherita',
            price: 2800,
            added_manually: false,
            claimed_by: [2],
        },
    ],
    participants: [
        { id: 1, display_name: 'Vince Woo', user_id: null },
        { id: 2, display_name: 'Maya', user_id: null },
    ],
    ...over,
});

function renderPage() {
    return render(
        <MemoryRouter initialEntries={[`/t/${SHARE_TOKEN}`]}>
            <Routes>
                <Route path="/t/:shareToken" element={<TabClaimPage />} />
            </Routes>
        </MemoryRouter>
    );
}

/** Take a seat, which is what puts the total (and the hand-off) on screen. */
async function join(over: Record<string, unknown> = {}) {
    vi.mocked(publicTabsApi.get).mockResolvedValue(tab(over));
    vi.mocked(publicTabsApi.join).mockResolvedValue({
        participant: { id: 2, display_name: 'Maya', user_id: null },
        claim_token: 'claim-token',
        tab: tab(over),
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Your first name'), {
        target: { value: 'Maya' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start claiming' }));
    await screen.findByText('Maya');
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('TabClaimPage Venmo hand-off', () => {
    it('offers to pay the host, for the share as it stands', async () => {
        await join();

        const link = await screen.findByRole('link', {
            name: 'Pay Vince Woo with Venmo',
        });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('vince-woo');
        expect(url.searchParams.get('amount')).toBe('28.00');
        // The venue, so the memo says what the money is for.
        expect(url.searchParams.get('note')).toBe('Bar Sol');
    });

    it('warns that a half-claimed share sends short', async () => {
        await join();
        await screen.findByRole('link', { name: 'Pay Vince Woo with Venmo' });
        screen.getByText(/Tap everything you had first/);
    });

    it('drops the warning once the tab is closed and the figure is final', async () => {
        await join({ status: 'closed' });
        await screen.findByRole('link', { name: 'Pay Vince Woo with Venmo' });
        expect(screen.queryByText(/Tap everything you had first/)).toBeNull();
        screen.getByText(/Splitwiser never sees the payment/);
    });

    it('offers nothing when the host has published no handle', async () => {
        await join({ host_venmo_username: null });
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('explains a tab billed in a currency Venmo cannot send', async () => {
        await join({ currency: 'EUR' });
        expect(screen.queryByRole('link')).toBeNull();
        await screen.findByText(/only sends US dollars/);
    });

    it('stays quiet for somebody who owes nothing', async () => {
        // Vince took the only line, so Maya's share is zero. Note that an
        // *unclaimed* line would not do: those spread across everyone at the
        // table, which is exactly why the warning above exists.
        await join({
            items: [
                {
                    id: 7,
                    description: 'Pizza margherita',
                    price: 2800,
                    added_manually: false,
                    claimed_by: [1],
                },
            ],
        });
        expect(screen.queryByRole('link')).toBeNull();
    });
});

describe('TabClaimPage with an off-app payer', () => {
    it('sends the table to whoever actually paid, not to the organiser', async () => {
        // Vince opened the tab and did the arithmetic; Dana handed over a card
        // and is not on Splitwiser at all. The server resolves the host, so
        // the page only has to render what it is told — but getting this wrong
        // sends six people's money to the wrong person, so it is asserted.
        await join({ host_name: 'Dana', host_venmo_username: 'dana-p' });

        const link = await screen.findByRole('link', {
            name: 'Pay Dana with Venmo',
        });
        expect(
            new URL(link.getAttribute('href')!).searchParams.get('recipients')
        ).toBe('dana-p');
    });

    it('names the payer in the closed-tab caption', async () => {
        await join({
            status: 'closed',
            host_name: 'Dana',
            host_venmo_username: 'dana-p',
        });

        await screen.findByText(/Sends Dana your share/);
    });
});
