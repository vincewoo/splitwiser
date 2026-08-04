import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupPersonSheet from '../GroupPersonSheet';
import type { GroupMember, GuestMember } from '../../../types/group';

const mergeGuest = vi.fn((_groupId: number, _guestId: number, _userId: number) =>
    Promise.resolve(new Response('{}', { status: 200 }))
);

vi.mock('../../../services/api', () => ({
    api: {
        groups: {
            mergeGuest: (groupId: number, guestId: number, userId: number) =>
                mergeGuest(groupId, guestId, userId),
            claimGuest: vi.fn(),
            manageGuest: vi.fn(),
            unmanageGuest: vi.fn(),
            manageMember: vi.fn(),
            unmanageMember: vi.fn(),
            removeGuest: vi.fn(),
            removeMember: vi.fn(),
        },
        friends: { sendRequest: vi.fn() },
    },
}));

vi.mock('../../../contexts/AppDataContext', () => ({
    useAppData: () => ({ friends: [] }),
}));

const OWNER = 1;
const BOB = 2;

const owner: GroupMember = {
    id: 1,
    user_id: OWNER,
    full_name: 'Alice',
    email: 'alice@example.com',
    managed_by_id: null,
    managed_by_type: null,
    managed_by_name: null,
};

/** Bob, who signed up and joined instead of claiming the guest below. */
const bob: GroupMember = {
    id: 2,
    user_id: BOB,
    full_name: 'Bob',
    email: 'bob@example.com',
    managed_by_id: null,
    managed_by_type: null,
    managed_by_name: null,
};

const bobsGuestSeat: GuestMember = {
    id: 7,
    group_id: 1,
    name: 'Bob (guest)',
    created_by_id: OWNER,
    claimed_by_id: null,
    managed_by_id: null,
    managed_by_type: null,
    managed_by_name: null,
};

function openSheet(overrides: { currentUserId?: number; ownerId?: number } = {}) {
    render(
        <GroupPersonSheet
            person={{ kind: 'guest', guest: bobsGuestSeat }}
            onClose={() => {}}
            groupId={1}
            members={[owner, bob]}
            guests={[bobsGuestSeat]}
            currentUserId={overrides.currentUserId ?? OWNER}
            ownerId={overrides.ownerId ?? OWNER}
            onChanged={() => {}}
        />
    );
}

const pickBob = () =>
    fireEvent.change(screen.getByLabelText('Which account is Bob (guest)'), {
        target: { value: String(BOB) },
    });

describe('GroupPersonSheet — merging a guest into an account', () => {
    beforeEach(() => mergeGuest.mockClear());

    it('merges the guest onto the account the owner picked', async () => {
        openSheet();
        pickBob();
        fireEvent.click(screen.getByRole('button', { name: /^Merge$/ }));

        // Confirmed first: the merge rewrites history and cannot be undone.
        expect(mergeGuest).not.toHaveBeenCalled();
        expect(await screen.findByText(/cannot be undone/i)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Merge$/ }));
        expect(mergeGuest).toHaveBeenCalledWith(1, 7, BOB);
    });

    it('backs out of the confirmation without merging', async () => {
        openSheet();
        pickBob();
        fireEvent.click(screen.getByRole('button', { name: /^Merge$/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(mergeGuest).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Which account is Bob (guest)')).toBeTruthy();
    });

    it('cannot merge before an account is picked', () => {
        openSheet();
        expect(
            screen.getByRole('button', { name: /^Merge$/ }).hasAttribute('disabled')
        ).toBe(true);
    });

    it('is offered to the group owner only', () => {
        openSheet({ currentUserId: BOB, ownerId: OWNER });
        expect(screen.queryByText('Merge into an account')).toBeNull();
        // Bob can still fold the seat onto himself the ordinary way.
        expect(screen.getByText('Claim this guest as me')).toBeTruthy();
    });

    it('is not offered for a guest somebody already claimed', () => {
        render(
            <GroupPersonSheet
                person={{
                    kind: 'guest',
                    guest: { ...bobsGuestSeat, claimed_by_id: BOB },
                }}
                onClose={() => {}}
                groupId={1}
                members={[owner, bob]}
                guests={[]}
                currentUserId={OWNER}
                ownerId={OWNER}
                onChanged={() => {}}
            />
        );
        expect(screen.queryByText('Merge into an account')).toBeNull();
    });

    it('is not offered for a member — merging only ever goes guest to account', () => {
        render(
            <GroupPersonSheet
                person={{ kind: 'member', member: bob }}
                onClose={() => {}}
                groupId={1}
                members={[owner, bob]}
                guests={[bobsGuestSeat]}
                currentUserId={OWNER}
                ownerId={OWNER}
                onChanged={() => {}}
            />
        );
        expect(screen.queryByText('Merge into an account')).toBeNull();
    });
});
