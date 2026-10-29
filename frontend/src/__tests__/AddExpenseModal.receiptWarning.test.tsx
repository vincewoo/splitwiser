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
let scan: {
    items: { description: string; price: number }[];
    total: number | null;
    tax?: number | null;
    tip?: number | null;
};

vi.mock('../ReceiptScanner', () => ({
    default: ({ onItemsDetected }: {
        onItemsDetected: (...args: unknown[]) => void;
    }) => (
        <button
            type="button"
            onClick={() =>
                onItemsDetected(scan.items, '/r.jpg', scan.tax ?? null, scan.tip ?? null, scan.total)
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

const rescan = () => {
    fireEvent.click(screen.getByRole('button', { name: '+ Scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish scan' }));
};

const UNDER = 'Some items may be missing';

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

    it('clears once the tax makes up the difference', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 1500 };
        renderScanned();
        expect(screen.getByText(UNDER)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '5.00' } });

        expect(screen.queryByText(UNDER)).not.toBeInTheDocument();
    });

    it('counts the scanned tax and tip towards the total', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 1500, tax: 200, tip: 300 };
        renderScanned();

        expect(screen.queryByText(UNDER)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Tip')).toHaveValue('3.00');
    });

    it('ignores a half-typed tax rather than reporting NaN', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 1500 };
        renderScanned();

        fireEvent.change(screen.getByLabelText('Tax'), { target: { value: '.' } });

        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
        expect(screen.getByText(/5\.00 under the receipt total/)).toBeInTheDocument();
    });

    it.each([null, 0])('shows nothing when the scan read a total of %s', total => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total };
        renderScanned();

        expect(screen.queryByText(UNDER)).not.toBeInTheDocument();
        expect(screen.queryByText('Items come to more than the receipt')).not.toBeInTheDocument();
    });

    it('stays dismissed while editing, and comes back with the next scan', () => {
        scan = { items: [{ description: 'Wings', price: 1000 }], total: 2000 };
        renderScanned();

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss warning' }));
        expect(screen.queryByText(UNDER)).not.toBeInTheDocument();

        addItem('Fries', '4.00');
        expect(screen.queryByText(UNDER)).not.toBeInTheDocument();

        rescan();
        expect(screen.getByText(UNDER)).toBeInTheDocument();
    });
});
