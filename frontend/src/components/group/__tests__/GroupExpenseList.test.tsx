import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GroupExpenseList from '../GroupExpenseList';
import type { GroupExpense } from '../../../hooks/useGroupData';

const VINCE = 1;

/** Tim settles $465 with Vince: Tim pays, the split lands on Vince. */
const settlement: GroupExpense = {
    id: 1,
    description: 'Tim pays Vince',
    amount: 46500,
    currency: 'USD',
    date: '2026-04-17',
    payer_id: 2,
    payer_is_guest: false,
    group_id: 1,
    is_settlement: true,
    splits: [
        {
            id: 1,
            expense_id: 1,
            user_id: VINCE,
            is_guest: false,
            amount_owed: 46500,
            user_name: 'Vince',
        },
    ],
};

const expense: GroupExpense = {
    id: 2,
    description: 'Catering',
    amount: 20000,
    currency: 'USD',
    date: '2026-04-17',
    payer_id: 2,
    payer_is_guest: false,
    group_id: 1,
    is_settlement: false,
    splits: [
        {
            id: 2,
            expense_id: 2,
            user_id: VINCE,
            is_guest: false,
            amount_owed: 10000,
            user_name: 'Vince',
        },
    ],
};

/** Tim receives a $200 refund split equally; Vince's $50 is in Tim's hands. */
const income: GroupExpense = {
    id: 3,
    description: 'Airbnb refund',
    amount: 20000,
    currency: 'USD',
    date: '2026-04-17',
    payer_id: 2,
    payer_is_guest: false,
    group_id: 1,
    kind: 'income',
    splits: [
        {
            id: 3,
            expense_id: 3,
            user_id: VINCE,
            is_guest: false,
            amount_owed: 5000,
            user_name: 'Vince',
        },
        {
            id: 4,
            expense_id: 3,
            user_id: 2,
            is_guest: false,
            amount_owed: 15000,
            user_name: 'Tim',
        },
    ],
};

const payerName = (e: GroupExpense) =>
    e.kind === 'income'
        ? 'Tim received'
        : e.payer_id === VINCE
          ? 'You paid'
          : 'Tim paid';

describe('GroupExpenseList', () => {
    it('leaves the impact hint off a settlement', () => {
        render(
            <GroupExpenseList
                expenses={[settlement]}
                currentUserId={VINCE}
                payerName={payerName}
            />
        );

        // Being paid is not taking on a debt.
        expect(screen.queryByText(/you owe/)).not.toBeInTheDocument();
        expect(screen.queryByText(/you lent/)).not.toBeInTheDocument();
        expect(screen.getByText('Tim pays Vince')).toBeInTheDocument();
    });

    it('still shows the impact hint on an expense', () => {
        render(
            <GroupExpenseList
                expenses={[expense]}
                currentUserId={VINCE}
                payerName={payerName}
            />
        );

        expect(screen.getByText(/you owe/)).toBeInTheDocument();
    });

    it('shows an income row as received, undimmed, with the sign reversed', () => {
        const { container } = render(
            <GroupExpenseList
                expenses={[income]}
                currentUserId={VINCE}
                payerName={payerName}
            />
        );

        // "received" copy, with the usual split summary beside it.
        expect(screen.getByText(/Tim received · equal, 2 ways/)).toBeInTheDocument();
        // Tim is holding Vince's $50, so Vince is up — not "you owe".
        expect(screen.getByText(/you're owed/)).toBeInTheDocument();
        expect(screen.queryByText(/you owe /)).not.toBeInTheDocument();
        // Money received is news, not a dimmed settlement.
        expect(container.querySelector('[class*="opacity-"]')).toBeNull();
        // No icon of its own, so the income fallback shows.
        expect(screen.getByText('💸')).toBeInTheDocument();
    });

    it('keeps the settlement row dimmed behind its bank tile', () => {
        const { container } = render(
            <GroupExpenseList
                expenses={[settlement]}
                currentUserId={VINCE}
                payerName={payerName}
            />
        );

        expect(screen.getByText('🏦')).toBeInTheDocument();
        expect(container.querySelector('[class*="opacity-"]')).not.toBeNull();
    });
});
