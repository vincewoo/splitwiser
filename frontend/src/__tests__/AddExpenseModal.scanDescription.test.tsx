import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';

// Scanning a receipt fills in a placeholder name. It used to do so even over
// a name the user had already typed, which the scan then threw away.

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

vi.mock('../ReceiptScanner', () => ({
    default: ({ onItemsDetected }: { onItemsDetected: (...args: unknown[]) => void }) => (
        <button
            type="button"
            onClick={() =>
                onItemsDetected([{ description: 'Ramen', price: 2000 }], '/r.jpg', null, null, 2000)
            }
        >
            Finish scan
        </button>
    ),
}));

const renderModal = () =>
    render(
        <AddExpenseModal
            isOpen
            onClose={vi.fn()}
            onExpenseAdded={vi.fn()}
            friends={[]}
            groups={[]}
        />
    );

const description = () => screen.getByLabelText('Description:') as HTMLInputElement;

const scan = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Scan a receipt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish scan' }));
};

describe('AddExpenseModal description after a receipt scan', () => {
    it('keeps a name typed before scanning', () => {
        renderModal();
        fireEvent.change(description(), { target: { value: 'Ramen night' } });

        scan();

        expect(description().value).toBe('Ramen night');
    });

    it('names an unnamed expense "Receipt Scan"', () => {
        renderModal();

        scan();

        expect(description().value).toBe('Receipt Scan');
    });

    it('treats a name of only spaces as unnamed', () => {
        renderModal();
        fireEvent.change(description(), { target: { value: '   ' } });

        scan();

        expect(description().value).toBe('Receipt Scan');
    });
});
