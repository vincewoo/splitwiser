import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';

// The modal only reads `isOnline` off the sync context, and pulling in the real
// one drags the syncManager / IndexedDB stack into the test.
vi.mock('../contexts/SyncContext', () => ({
    useSync: () => ({ isOnline: true }),
}));

vi.mock('../AuthContext', () => ({
    useAuth: () => ({
        user: { id: 1, full_name: 'Vince', email: 'v@example.com', default_currency: 'USD' },
    }),
}));

// The group roster is fetched on open; the list endpoint that feeds `groups`
// does not carry members or guests.
const getGroupById = vi.fn();
vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: { getById: (id: number) => getGroupById(id) },
    offlineExpensesApi: { create: vi.fn() },
}));

const groupDetail = {
    id: 7,
    name: 'Ski trip',
    created_by_id: 1,
    default_currency: 'USD',
    members: [
        { id: 1, user_id: 1, full_name: 'Vince', email: 'v@example.com' },
        { id: 2, user_id: 2, full_name: 'Dana', email: 'd@example.com' },
    ],
    guests: [{ id: 5, group_id: 7, name: 'Sam', created_by_id: 1 }],
};

/** The group as the list endpoint returns it — no members, no guests. */
const listedGroup = {
    id: 7,
    name: 'Ski trip',
    created_by_id: 1,
    default_currency: 'USD',
};

function renderModal() {
    return render(
        <AddExpenseModal
            isOpen={true}
            onClose={() => {}}
            onExpenseAdded={() => {}}
            friends={[]}
            groups={[listedGroup]}
            preselectedGroupId={7}
        />
    );
}

describe('AddExpenseModal in a group', () => {
    beforeEach(() => {
        getGroupById.mockReset();
        getGroupById.mockResolvedValue(groupDetail);
    });

    it('offers the group members and guests as participants', async () => {
        renderModal();

        await waitFor(() => expect(getGroupById).toHaveBeenCalledWith(7));

        // "You" stands in for the current user; the others come from the roster.
        expect(await screen.findByRole('button', { name: 'Dana' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Sam' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'You' })).toBeInTheDocument();
    });

    it('offers the group members and guests as payers', async () => {
        renderModal();

        const payerSelect = await screen.findByLabelText('Paid by:');
        const options = [...payerSelect.querySelectorAll('option')].map(o => o.textContent);
        expect(options).toEqual(['You', 'Dana', 'Sam']);
    });

    it('says so when the roster cannot be loaded', async () => {
        getGroupById.mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderModal();

        // A failed fetch is not an empty group. Saying "no other members"
        // here is what sent people looking for a bug in their group.
        expect(
            await screen.findByText(/Couldn't load this group's members/i)
        ).toBeInTheDocument();
        expect(
            screen.queryByText('No other members in this group')
        ).not.toBeInTheDocument();

        consoleError.mockRestore();
    });
});

describe('AddExpenseModal amount entry', () => {
    beforeEach(() => {
        getGroupById.mockReset();
        getGroupById.mockResolvedValue(groupDetail);
    });

    it('takes the amount in a field the system numeric keyboard serves', () => {
        renderModal();

        const amount = screen.getByLabelText('Amount');
        expect(amount).toHaveAttribute('inputmode', 'decimal');
        // type="number" would bring spinners and locale-dependent parsing.
        expect(amount).toHaveAttribute('type', 'text');
    });

    it('has no in-app keypad', () => {
        renderModal();

        // The keypad's own keys — a digit button and its backspace.
        expect(screen.queryByRole('button', { name: '7' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });
});
