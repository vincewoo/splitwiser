import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExpenseItemList from '../ExpenseItemList';
import type { ExpenseItem, Participant } from '../../../types/expense';

const alice: Participant = { id: 1, name: 'Alice', isGuest: false };
const bob: Participant = { id: 2, name: 'Bob', isGuest: false };
/** Saved expense guest whose id collides with Alice's user id on purpose. */
const savedGuest: Participant = { id: 1, name: 'Walk-in', isGuest: false, isExpenseGuest: true };

const baseItem = (overrides: Partial<ExpenseItem>): ExpenseItem => ({
    description: 'Kid Burger',
    price: 2400,
    is_tax_tip: false,
    assignments: [
        { user_id: 1, is_guest: false },
        { user_id: 2, is_guest: false },
    ],
    split_type: 'EQUAL',
    ...overrides,
});

const renderList = (item: ExpenseItem, participants: Participant[] = [alice, bob]) => {
    const onChangeSplitType = vi.fn();
    const onUpdateSplitDetail = vi.fn();
    render(
        <ExpenseItemList
            items={[item]}
            participants={participants}
            onToggleAssignment={vi.fn()}
            onRemoveItem={vi.fn()}
            onOpenSelector={vi.fn()}
            onChangeSplitType={onChangeSplitType}
            onUpdateSplitDetail={onUpdateSplitDetail}
            getParticipantName={(p) => p.name}
            currentUserId={1}
        />
    );
    return { onChangeSplitType, onUpdateSplitDetail };
};

describe('ExpenseItemList split controls', () => {
    it('tapping the Shares pill dispatches onChangeSplitType — the edit-mode mount once silently dropped this', () => {
        const { onChangeSplitType } = renderList(baseItem({}));
        fireEvent.click(screen.getByRole('radio', { name: 'Shares' }));
        expect(onChangeSplitType).toHaveBeenCalledWith(0, 'SHARES');
    });

    it('editing a share input dispatches onUpdateSplitDetail with the participant key', () => {
        const { onUpdateSplitDetail } = renderList(
            baseItem({
                split_type: 'SHARES',
                split_details: { user_1: { shares: 2 }, user_2: { shares: 1 } },
            })
        );
        fireEvent.change(screen.getByLabelText('Shares for Alice'), { target: { value: '5' } });
        expect(onUpdateSplitDetail).toHaveBeenCalledWith(0, 'user_1', { shares: 5 });
    });

    it('keys an expense guest as expense_guest_{id}, not as the colliding user key', () => {
        const { onUpdateSplitDetail } = renderList(
            baseItem({
                assignments: [
                    { user_id: 1, is_guest: false },
                    { user_id: 1, is_guest: false, expense_guest_id: 1 },
                ],
                split_type: 'SHARES',
                split_details: { user_1: { shares: 2 }, expense_guest_1: { shares: 3 } },
            }),
            [alice, savedGuest]
        );
        const guestInput = screen.getByLabelText('Shares for Walk-in');
        expect(guestInput).toHaveValue(3);
        fireEvent.change(guestInput, { target: { value: '4' } });
        expect(onUpdateSplitDetail).toHaveBeenCalledWith(0, 'expense_guest_1', { shares: 4 });
        // Alice's own input reads her key, untouched by the guest's.
        expect(screen.getByLabelText('Shares for Alice')).toHaveValue(2);
    });
});
