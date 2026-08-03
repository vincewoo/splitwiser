import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddExpenseModal from '../AddExpenseModal';
import { offlineGroupsApi, offlineExpensesApi } from '../services/offlineApi';

// GET /groups omits members and guests, so the modal has to fetch the picked
// group before it can offer anyone. These tests pin that down: they hand the
// modal exactly the members-less shape the list endpoint returns.
vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: { getById: vi.fn() },
    offlineExpensesApi: { create: vi.fn() },
}));

vi.mock('../AuthContext', () => ({
    useAuth: () => ({ user: { id: 1, email: 'you@example.com', full_name: 'You' }, loading: false }),
}));

vi.mock('../contexts/SyncContext', () => ({ useSync: () => ({ isOnline: true }) }));

vi.mock('../hooks/useCurrencyPreferences', () => ({
    useCurrencyPreferences: () => ({
        sortedCurrencies: [
            { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
            { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
            { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
        ],
        recordCurrencyUsage: vi.fn(),
        hasRecentCurrencies: false,
    }),
}));

vi.mock('../ReceiptScanner', () => ({ default: () => null }));

/** What GET /groups actually returns: no `members`, no `guests`. */
const listGroups = [
    { id: 10, name: 'Repro Trip', created_by_id: 1, default_currency: 'USD' },
    { id: 20, name: 'Ski Cabin', created_by_id: 1, default_currency: 'EUR' },
];

const member = { id: 1, user_id: 1, full_name: 'You', email: 'you@example.com' };

/**
 * What GET /groups/{id} returns. Guest ids are deliberately assignable so a
 * test can make two groups share one — guest ids are only unique per group,
 * which is the collision the group-switch reset exists to prevent.
 */
const detail = (id: number, guests: { id: number; name: string }[]) => ({
    ...listGroups.find(g => g.id === id)!,
    members: [member],
    guests: guests.map(g => ({
        id: g.id,
        group_id: id,
        name: g.name,
        created_by_id: 1,
        claimed_by_id: null,
    })),
});

const named = (id: number, names: string[]) =>
    detail(id, names.map((name, i) => ({ id: id * 100 + i, name })));

const renderModal = (props: Partial<React.ComponentProps<typeof AddExpenseModal>> = {}) =>
    render(
        <AddExpenseModal
            isOpen
            onClose={vi.fn()}
            onExpenseAdded={vi.fn()}
            friends={[]}
            groups={listGroups}
            {...props}
        />
    );

const pickGroup = (name: string | null) => {
    const select = screen.getByLabelText(/Group \(optional\)/i);
    fireEvent.change(select, {
        target: { value: name === null ? '' : String(listGroups.find(g => g.name === name)!.id) },
    });
};

// Everyone shows up twice — once as a participant chip, once as a "Paid by"
// option — so these query the chips specifically.
const chip = (name: string) => screen.getByRole('button', { name });
const noChip = (name: string) => screen.queryByRole('button', { name });

const currencySelect = () => screen.getByLabelText(/Currency/i) as HTMLSelectElement;

/** Fill in the bits handleSubmit needs, then submit. */
const fillAndSave = (amount: string, description = 'Dinner') => {
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: description } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
};

describe('AddExpenseModal group roster', () => {
    beforeEach(() => {
        vi.mocked(offlineGroupsApi.getById).mockReset();
        vi.mocked(offlineExpensesApi.create).mockReset();
        vi.mocked(offlineExpensesApi.create).mockResolvedValue({ success: true, data: {}, offline: false });
    });

    it('shows the group members as soon as the group is picked', async () => {
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(
            named(10, ['Alice', 'Bob', 'Carol'])
        );

        renderModal();
        pickGroup('Repro Trip');

        await waitFor(() => {
            expect(chip('Alice')).toBeInTheDocument();
        });
        expect(chip('Bob')).toBeInTheDocument();
        expect(chip('Carol')).toBeInTheDocument();
        expect(
            screen.queryByText(/No other members in this group/i)
        ).not.toBeInTheDocument();
    });

    it('offers every group member as a possible payer, not just you', async () => {
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(10, ['Alice', 'Bob']));

        renderModal();
        pickGroup('Repro Trip');

        await waitFor(() => expect(chip('Alice')).toBeInTheDocument());

        const payer = screen.getByLabelText(/Paid by/i);
        expect(
            Array.from(payer.querySelectorAll('option')).map(o => o.textContent)
        ).toEqual(['You', 'Alice', 'Bob']);
    });

    it('says it is loading rather than claiming the group is empty', async () => {
        let resolveFetch: (group: unknown) => void = () => {};
        vi.mocked(offlineGroupsApi.getById).mockReturnValue(
            new Promise(resolve => {
                resolveFetch = resolve;
            }) as ReturnType<typeof offlineGroupsApi.getById>
        );

        renderModal();
        pickGroup('Repro Trip');

        // The bug this guards: an empty roster read as "nobody is in this group".
        expect(
            screen.queryByText(/No other members in this group/i)
        ).not.toBeInTheDocument();
        expect(screen.getByText(/Loading members/i)).toBeInTheDocument();

        resolveFetch(named(10, ['Alice']));
        await waitFor(() => expect(chip('Alice')).toBeInTheDocument());
    });

    it('swaps the roster when a different group is picked', async () => {
        vi.mocked(offlineGroupsApi.getById).mockImplementation((id: number | string) =>
            Promise.resolve(
                id === 10 ? named(10, ['Alice', 'Bob']) : named(20, ['Dave', 'Erin'])
            )
        );

        renderModal();

        pickGroup('Repro Trip');
        await waitFor(() => expect(chip('Alice')).toBeInTheDocument());

        pickGroup('Ski Cabin');
        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());

        expect(chip('Erin')).toBeInTheDocument();
        // Guests only mean anything inside their own group.
        expect(noChip('Alice')).toBeNull();
        expect(noChip('Bob')).toBeNull();
    });

    it('ignores a slow response for a group the user already moved off', async () => {
        const pending: Record<number, (group: unknown) => void> = {};
        vi.mocked(offlineGroupsApi.getById).mockImplementation(
            (id: number | string) =>
                new Promise(resolve => {
                    pending[id as number] = resolve;
                }) as ReturnType<typeof offlineGroupsApi.getById>
        );

        renderModal();

        pickGroup('Repro Trip');
        pickGroup('Ski Cabin');

        // The abandoned request lands last; it must not repopulate the form.
        pending[20](named(20, ['Dave', 'Erin']));
        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());

        pending[10](named(10, ['Alice', 'Bob']));
        await waitFor(() => expect(chip('Erin')).toBeInTheDocument());
        expect(noChip('Alice')).toBeNull();
    });

    it('loads the roster for a preselected group with no user interaction', async () => {
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(20, ['Dave', 'Erin']));

        renderModal({ preselectedGroupId: 20 });

        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());
        expect(chip('Erin')).toBeInTheDocument();
        expect(offlineGroupsApi.getById).toHaveBeenCalledWith(20);
    });

    it('restores the friends list when the group is cleared', async () => {
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(10, ['Alice']));

        renderModal();
        pickGroup('Repro Trip');
        await waitFor(() => expect(chip('Alice')).toBeInTheDocument());

        pickGroup(null);

        await waitFor(() => expect(noChip('Alice')).toBeNull());
        expect(screen.queryByText(/Loading members/i)).not.toBeInTheDocument();
        expect(
            screen.getByText(/Add friends or select a group with members/i)
        ).toBeInTheDocument();
    });
});

describe('AddExpenseModal roster failures', () => {
    beforeEach(() => {
        vi.mocked(offlineGroupsApi.getById).mockReset();
        vi.mocked(offlineExpensesApi.create).mockReset();
        vi.mocked(offlineExpensesApi.create).mockResolvedValue({ success: true, data: {}, offline: false });
    });

    it('reports a failed roster fetch instead of showing an empty group', async () => {
        vi.mocked(offlineGroupsApi.getById).mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        renderModal();
        pickGroup('Repro Trip');

        await waitFor(() => {
            expect(screen.getByText(/Couldn't load this group's members/i)).toBeInTheDocument();
        });
        expect(
            screen.queryByText(/No other members in this group/i)
        ).not.toBeInTheDocument();

        consoleError.mockRestore();
    });

    it('treats a cached list-shaped group as a failure, not as an empty group', async () => {
        // getById falls back to the IndexedDB cache when the network fails, and
        // that row can be a GET /groups stub with no roster on it. Reporting
        // that as "no other members" is the original bug.
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(listGroups[0]);

        renderModal();
        pickGroup('Repro Trip');

        await waitFor(() => {
            expect(screen.getByText(/Couldn't load this group's members/i)).toBeInTheDocument();
        });
        expect(
            screen.queryByText(/No other members in this group/i)
        ).not.toBeInTheDocument();
    });

    it('retries the same group when asked, which re-picking it cannot do', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(offlineGroupsApi.getById)
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(named(10, ['Alice']));

        renderModal();
        pickGroup('Repro Trip');

        await waitFor(() =>
            expect(screen.getByText(/Couldn't load this group's members/i)).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

        await waitFor(() => expect(chip('Alice')).toBeInTheDocument());
        expect(screen.queryByText(/Couldn't load this group's members/i)).not.toBeInTheDocument();

        consoleError.mockRestore();
    });

    it('refuses to save while the roster is still loading', async () => {
        vi.mocked(offlineGroupsApi.getById).mockReturnValue(
            new Promise(() => {}) as ReturnType<typeof offlineGroupsApi.getById>
        );

        renderModal();
        pickGroup('Repro Trip');
        await waitFor(() => expect(screen.getByText(/Loading members/i)).toBeInTheDocument());

        fillAndSave('60');

        // Saving here would post a group expense split entirely to the submitter.
        expect(offlineExpensesApi.create).not.toHaveBeenCalled();
    });
});

describe('AddExpenseModal group switching', () => {
    beforeEach(() => {
        vi.mocked(offlineGroupsApi.getById).mockReset();
        vi.mocked(offlineExpensesApi.create).mockReset();
        vi.mocked(offlineExpensesApi.create).mockResolvedValue({ success: true, data: {}, offline: false });
    });

    it('does not carry a guest selection across groups that share a guest id', async () => {
        // Guest ids are unique per group, so 1000 is Bob here and Dave there.
        vi.mocked(offlineGroupsApi.getById).mockImplementation((id: number | string) =>
            Promise.resolve(
                id === 10
                    ? detail(10, [{ id: 1000, name: 'Bob' }])
                    : detail(20, [{ id: 1000, name: 'Dave' }])
            )
        );

        renderModal();

        pickGroup('Repro Trip');
        await waitFor(() => expect(chip('Bob')).toBeInTheDocument());
        fireEvent.click(chip('Bob'));

        pickGroup('Ski Cabin');
        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());

        fillAndSave('60');

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const payload = vi.mocked(offlineExpensesApi.create).mock.calls[0][0];

        expect(payload.group_id).toBe(20);
        // Dave inherited Bob's id, not his selection: only "You" is splitting.
        expect(payload.splits).toHaveLength(1);
        expect(payload.splits[0]).toMatchObject({ user_id: 1, is_guest: false });
    });

    it('does not carry a guest payer across groups', async () => {
        vi.mocked(offlineGroupsApi.getById).mockImplementation((id: number | string) =>
            Promise.resolve(
                id === 10
                    ? detail(10, [{ id: 1000, name: 'Bob' }])
                    : detail(20, [{ id: 1000, name: 'Dave' }])
            )
        );

        renderModal();

        pickGroup('Repro Trip');
        await waitFor(() => expect(chip('Bob')).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText(/Paid by/i), { target: { value: 'guest_1000' } });

        pickGroup('Ski Cabin');
        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());

        fillAndSave('60');

        await waitFor(() => expect(offlineExpensesApi.create).toHaveBeenCalled());
        const payload = vi.mocked(offlineExpensesApi.create).mock.calls[0][0];

        expect(payload.payer_is_guest).toBe(false);
        expect(payload.payer_id).toBe(1);
    });
});

describe('AddExpenseModal currency', () => {
    beforeEach(() => {
        vi.mocked(offlineGroupsApi.getById).mockReset();
        vi.mocked(offlineExpensesApi.create).mockReset();
    });

    it('adopts the group default when the group is picked', async () => {
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(20, ['Dave']));

        renderModal();
        pickGroup('Ski Cabin');

        await waitFor(() => expect(currencySelect().value).toBe('EUR'));
    });

    it('keeps a currency the user chose when the roster lands', async () => {
        let resolveFetch: (group: unknown) => void = () => {};
        vi.mocked(offlineGroupsApi.getById).mockReturnValue(
            new Promise(resolve => {
                resolveFetch = resolve;
            }) as ReturnType<typeof offlineGroupsApi.getById>
        );

        renderModal();
        pickGroup('Ski Cabin');
        await waitFor(() => expect(currencySelect().value).toBe('EUR'));

        fireEvent.change(currencySelect(), { target: { value: 'JPY' } });
        expect(currencySelect().value).toBe('JPY');

        resolveFetch(named(20, ['Dave']));
        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());

        // The fetch resolving must not undo a deliberate choice.
        expect(currencySelect().value).toBe('JPY');
    });

    it('keeps a currency the user chose when the group list refreshes under it', async () => {
        // A background refresh can report a different default_currency for the
        // selected group. That must not overrule a choice already made here.
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(20, ['Dave']));
        const props = {
            isOpen: true as const,
            onClose: vi.fn(),
            onExpenseAdded: vi.fn(),
            friends: [],
            preselectedGroupId: 20,
        };

        const { rerender } = render(<AddExpenseModal {...props} groups={listGroups} />);
        await waitFor(() => expect(currencySelect().value).toBe('EUR'));

        fireEvent.change(currencySelect(), { target: { value: 'JPY' } });
        expect(currencySelect().value).toBe('JPY');

        rerender(
            <AddExpenseModal
                {...props}
                groups={[listGroups[0], { ...listGroups[1], default_currency: 'USD' }]}
            />
        );

        await waitFor(() => expect(chip('Dave')).toBeInTheDocument());
        expect(currencySelect().value).toBe('JPY');
    });

    it('adopts the group default when the groups list arrives after the modal', async () => {
        // AppDataContext starts `groups` empty and fills it asynchronously, so
        // a modal opened on a preselected group can render before its group is
        // even in the list. Keying only on the id would strand it on USD.
        vi.mocked(offlineGroupsApi.getById).mockResolvedValue(named(20, ['Dave']));

        const { rerender } = render(
            <AddExpenseModal
                isOpen
                onClose={vi.fn()}
                onExpenseAdded={vi.fn()}
                friends={[]}
                groups={[]}
                preselectedGroupId={20}
            />
        );

        rerender(
            <AddExpenseModal
                isOpen
                onClose={vi.fn()}
                onExpenseAdded={vi.fn()}
                friends={[]}
                groups={listGroups}
                preselectedGroupId={20}
            />
        );

        await waitFor(() => expect(currencySelect().value).toBe('EUR'));
    });
});
