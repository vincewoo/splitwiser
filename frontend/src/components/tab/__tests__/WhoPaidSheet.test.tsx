import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WhoPaidSheet from '../WhoPaidSheet';
import type { TabParticipant } from '../../../types/tab';

/** Fresh objects every call — the board hands this a new array on every poll. */
const participants = (): TabParticipant[] => [
    { id: 1, display_name: 'Vince Woo', user_id: 9 },
    { id: 2, display_name: 'Dana', user_id: null },
    { id: 3, display_name: 'Maya', user_id: 12 },
];

function renderSheet(props: Partial<React.ComponentProps<typeof WhoPaidSheet>> = {}) {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
        <WhoPaidSheet
            open
            onClose={() => {}}
            participants={participants()}
            payerId={1}
            meId={1}
            onSave={onSave}
            {...props}
        />
    );
    return { ...view, onSave };
}

const chip = (name: string) => screen.getByRole('button', { name });
const isPicked = (name: string) =>
    chip(name).getAttribute('aria-pressed') === 'true';

describe('WhoPaidSheet', () => {
    it('starts on whoever is already credited with paying', () => {
        renderSheet();
        expect(isPicked('You')).toBe(true);
        expect(isPicked('Dana')).toBe(false);
    });

    it('keeps your pick when the board polls underneath it', async () => {
        // The bug: the board re-reads the tab every few seconds and passes a
        // fresh `participants` array. An effect syncing the draft treated that
        // as a reason to re-seed, so a moment after picking Dana the selection
        // snapped back to the saved payer — you.
        const { rerender, onSave } = renderSheet();

        fireEvent.click(chip('Dana'));
        expect(isPicked('Dana')).toBe(true);

        // Three polls land, each with new object identities and the *old*
        // payerId, because nothing has been saved yet.
        for (let poll = 0; poll < 3; poll += 1) {
            rerender(
                <WhoPaidSheet
                    open
                    onClose={() => {}}
                    participants={participants()}
                    payerId={1}
                    meId={1}
                    onSave={onSave}
                />
            );
        }

        expect(isPicked('Dana')).toBe(true);
        expect(isPicked('You')).toBe(false);
    });

    it('keeps a half-typed handle across a poll too', () => {
        const { rerender, onSave } = renderSheet();

        fireEvent.click(chip('Dana'));
        fireEvent.change(screen.getByLabelText("Dana's Venmo"), {
            target: { value: 'dana-p' },
        });

        rerender(
            <WhoPaidSheet
                open
                onClose={() => {}}
                participants={participants()}
                payerId={1}
                meId={1}
                onSave={onSave}
            />
        );

        expect(screen.getByLabelText("Dana's Venmo")).toHaveValue('dana-p');
    });

    it('starts fresh the next time it is opened', () => {
        const { rerender, onSave } = renderSheet();
        fireEvent.click(chip('Dana'));

        // Closed, then opened again without anything having been saved.
        const props = {
            onClose: () => {},
            participants: participants(),
            payerId: 1,
            meId: 1,
            onSave,
        };
        rerender(<WhoPaidSheet open={false} {...props} />);
        rerender(<WhoPaidSheet open {...props} />);

        expect(isPicked('You')).toBe(true);
    });

    it('asks for a handle only when the payer has no account', () => {
        renderSheet();
        expect(screen.queryByLabelText(/Venmo/)).toBeNull();

        fireEvent.click(chip('Dana'));
        expect(screen.getByLabelText("Dana's Venmo")).toBeInTheDocument();

        // Maya has an account, so hers comes from her own profile.
        fireEvent.click(chip('Maya'));
        expect(screen.queryByLabelText(/Venmo/)).toBeNull();
        screen.getByText(/comes from their account settings/);
    });

    it('saves the pick and the handle together', async () => {
        const { onSave } = renderSheet();

        fireEvent.click(chip('Dana'));
        fireEvent.change(screen.getByLabelText("Dana's Venmo"), {
            target: { value: '@dana-p' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSave).toHaveBeenCalledWith(2, 'dana-p'));
    });

    it('sends no handle for somebody who has an account', async () => {
        const { onSave } = renderSheet();

        fireEvent.click(chip('Maya'));
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(onSave).toHaveBeenCalledWith(3, undefined));
    });

    it('refuses a handle Venmo could not use', async () => {
        const { onSave } = renderSheet();

        fireEvent.click(chip('Dana'));
        fireEvent.change(screen.getByLabelText("Dana's Venmo"), {
            target: { value: 'not a handle' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        screen.getByText(/letters, numbers/);
        expect(onSave).not.toHaveBeenCalled();
    });
});
