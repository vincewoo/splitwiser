import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';

// The "under / over the receipt total" warning after a scan. It used to be a
// string frozen at scan time, so it stayed up after the missing items were
// added. These tests pin that it follows the items as they are fixed.

vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: { getById: vi.fn() },
    offlineExpensesApi: { create: vi.fn() },
}));

vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        user: { id: 1, email: 'you@example.com', full_name: 'You' },
        loading: false,
    }),
}));

vi.mock('../contexts/SyncContext', () => ({ useSync: () => ({ isOnline: true }) }));

vi.mock('../hooks/useCurrencyPreferences', () => ({
    useCurrencyPreferences: () => ({
        sortedCurrencies: [{ code: 'USD', name: 'US Dollar', flag: '🇺🇸' }],
        recordCurrencyUsage: vi.fn(),
        hasRecentCurrencies: false,
    }),
}));

// What the scan "returns" for the current test.
let scan: { items: { description: string; price: number }[]; total: number };

// The one-line warning the real scanner hands over, in its own format. The
// form must not lean on it: a frozen copy is exactly what went stale.
const scannerWarning = () => {
    const computed = scan.items.reduce((sum, item) => sum + item.price, 0);
    const delta = scan.total - computed;
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    return `Items, tax and tip come to ${money(computed)}, which is ${money(Math.abs(delta))} ${delta > 0 ? 'under' : 'over'} the receipt total.`;
};

vi.mock('../ReceiptScanner', () => ({
    default: ({ onItemsDetected }: {
        onItemsDetected: (...args: unknown[]) => void;
    }) => (
        <button
            type="button"
            onClick={() =>
                onItemsDetected(scan.items, '/r.jpg', scannerWarning(), null, null, scan.total)
            }
        >
            Finish scan
        </button>
    ),
}));

const renderScanned = () => {
    render(
        <AddExpenseModal
            isOpen
            openScanner
            onClose={vi.fn()}
            onExpenseAdded={vi.fn()}
            friends={[]}
            groups={[]}
        />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish scan' }));
};

const addItem = (description: string, price: string) => {
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Item description'), {
        target: { value: description },
    });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: price } });
    // Submit the form itself: jsdom's step check on the price input
    // (step 0.01 from min 0.01) misfires on float error and blocks a click.
    fireEvent.submit(screen.getByRole('button', { name: 'Add item' }).closest('form')!);
};

describe('AddExpenseModal receipt total warning', () => {
    it('clears once the missing item is added', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 1500 };
        renderScanned();

        expect(screen.getByText('Some items may be missing')).toBeInTheDocument();
        expect(screen.getByText(/5\.00 under the receipt total/)).toBeInTheDocument();

        addItem('Fries', '5.00');

        expect(screen.queryByText('Some items may be missing')).not.toBeInTheDocument();
    });

    it('updates the amount while a gap remains', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 2000 };
        renderScanned();
        expect(screen.getByText(/10\.00 under the receipt total/)).toBeInTheDocument();

        addItem('Fries', '4.00');

        expect(screen.getByText(/6\.00 under the receipt total/)).toBeInTheDocument();
    });

    it('clears an over-total warning once the duplicate line is removed', () => {
        scan = {
            items: [
                { description: 'Wings', price: 1000 },
                { description: 'Wings', price: 1000 },
            ],
            total: 1000,
        };
        renderScanned();
        expect(screen.getByText('Items come to more than the receipt')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[0]);

        expect(
            screen.queryByText('Items come to more than the receipt')
        ).not.toBeInTheDocument();
    });
});
