import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettleUpModal from '../SettleUpModal';

vi.mock('../services/api', () => ({ api: { expenses: { create: vi.fn() } } }));
vi.mock('../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin' }, loading: false }),
}));

const friends = [
    {
        id: 2,
        full_name: 'Sam Okafor',
        email: 'sam@example.com',
        venmo_username: 'sam-ok',
    },
    { id: 3, full_name: 'Dev Rao', email: 'dev@example.com', venmo_username: null },
];

const open = (preselectedFriendId = 2) =>
    render(
        <SettleUpModal
            isOpen
            onClose={() => {}}
            onSettled={() => {}}
            friends={friends}
            preselectedFriendId={preselectedFriendId}
        />
    );

const typeAmount = (value: string) =>
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value } });

describe('SettleUpModal Venmo hand-off', () => {
    it('waits for a real amount — a blank Venmo link is worse than none', () => {
        open();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('carries the typed amount over to Venmo', () => {
        open();
        typeAmount('42.35');

        const link = screen.getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('sam-ok');
        expect(url.searchParams.get('amount')).toBe('42.35');
    });

    it('follows the amount as it is edited', () => {
        open();
        typeAmount('42.35');
        typeAmount('7');

        const link = screen.getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        expect(new URL(link.getAttribute('href')!).searchParams.get('amount')).toBe(
            '7.00'
        );
    });

    it('offers nothing for a friend who has published no handle', () => {
        open(3);
        typeAmount('42.35');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('explains itself when the payment is not in dollars', () => {
        open();
        typeAmount('42.35');
        fireEvent.change(screen.getByLabelText('Currency'), {
            target: { value: 'EUR' },
        });

        expect(screen.queryByRole('link')).toBeNull();
        screen.getByText(/only sends US dollars/);
    });

    it('keeps saving as the thing that records the payment', () => {
        open();
        typeAmount('42.35');
        screen.getByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        screen.getByRole('button', { name: 'Save' });
    });
});
