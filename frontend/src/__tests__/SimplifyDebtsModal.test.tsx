import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SimplifyDebtsModal from '../SimplifyDebtsModal';

const simplifyDebts = vi.fn();
vi.mock('../services/api', () => ({
    api: {
        balances: { simplifyDebts: (...args: unknown[]) => simplifyDebts(...args) },
        expenses: { create: vi.fn() },
    },
}));

// Maya is the signed-in user throughout.
vi.mock('../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, full_name: 'Maya Lin' }, loading: false }),
}));

const members = [
    { id: 10, user_id: 1, full_name: 'Maya Lin' },
    { id: 11, user_id: 2, full_name: 'Sam Okafor' },
    { id: 12, user_id: 3, full_name: 'Dev Rao' },
];
const guests = [{ id: 5, name: 'Table 4' }];

const participants = [
    { user_id: 1, is_guest: false, display_name: 'Maya Lin', venmo_username: 'maya-l' },
    { user_id: 2, is_guest: false, display_name: 'Sam Okafor', venmo_username: 'sam-ok' },
    { user_id: 3, is_guest: false, display_name: 'Dev Rao', venmo_username: 'dev-r' },
    { user_id: 5, is_guest: true, display_name: 'Table 4', venmo_username: null },
];

const tx = (from: number, to: number, extra: Record<string, unknown> = {}) => ({
    from_id: from,
    from_is_guest: false,
    to_id: to,
    to_is_guest: false,
    amount: 4235,
    currency: 'USD',
    ...extra,
});

const open = () =>
    render(
        <SimplifyDebtsModal
            isOpen
            onClose={() => {}}
            groupId={7}
            groupName="Tahoe"
            members={members}
            guests={guests}
        />
    );

beforeEach(() => {
    simplifyDebts.mockReset();
});

describe('SimplifyDebtsModal Venmo hand-off', () => {
    it('offers to pay the person the signed-in user owes', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants,
        });
        open();

        const link = await screen.findByRole('link', {
            name: 'Pay Sam Okafor with Venmo',
        });
        const url = new URL(link.getAttribute('href')!);
        expect(url.searchParams.get('txn')).toBe('pay');
        expect(url.searchParams.get('recipients')).toBe('sam-ok');
        expect(url.searchParams.get('amount')).toBe('42.35');
        expect(url.searchParams.get('note')).toBe('Settling up: Tahoe');
    });

    it('asks rather than pays when the debt runs the other way', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(2, 1)],
            participants,
        });
        open();

        const link = await screen.findByRole('link', {
            name: 'Ask Sam Okafor on Venmo',
        });
        expect(new URL(link.getAttribute('href')!).searchParams.get('txn')).toBe(
            'charge'
        );
    });

    it('offers nothing for a payment between two other people', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(2, 3)],
            participants,
        });
        open();

        await screen.findByText('Sam Okafor');
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers nothing when the counterparty has published no handle', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants: participants.map((p) =>
                p.user_id === 2 ? { ...p, venmo_username: null } : p
            ),
        });
        open();

        await screen.findByText('Sam Okafor');
        expect(screen.queryByRole('link')).toBeNull();
        // Nothing the viewer can act on, so nothing is said about it.
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('explains a debt in a currency Venmo cannot send', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2, { currency: 'EUR' })],
            participants,
        });
        open();

        await screen.findByText(/only sends US dollars/);
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers nothing when the counterparty is a guest with no account', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 5, { to_is_guest: true })],
            participants,
        });
        open();

        await screen.findByText('Table 4');
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.queryByText(/only sends US dollars/)).toBeNull();
    });

    it('keeps recording separate from the hand-off', async () => {
        simplifyDebts.mockResolvedValue({
            transactions: [tx(1, 2)],
            participants,
        });
        open();

        await screen.findByRole('link', { name: 'Pay Sam Okafor with Venmo' });
        // Opening Venmo tells us nothing about whether the money moved, so the
        // deliberate "mark as paid" stays alongside it.
        screen.getByRole('button', { name: 'Mark as paid' });
    });

    it('survives a response with no participants directory', async () => {
        simplifyDebts.mockResolvedValue({ transactions: [tx(1, 2)] });
        open();

        await waitFor(() => screen.getByText('Sam Okafor'));
        expect(screen.queryByRole('link')).toBeNull();
    });
});
