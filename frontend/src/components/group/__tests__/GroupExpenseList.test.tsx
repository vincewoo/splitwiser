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

const payerName = (e: GroupExpense) => (e.payer_id === VINCE ? 'You paid' : 'Tim paid');

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
});
