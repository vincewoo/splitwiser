import React, { useState } from 'react';
import { Avatar, Button, Field, Notice, Sheet } from '../ui';
import { normalizeVenmoUsername, venmoUsernameError } from '../../utils/venmo';
import type { TabParticipant } from '../../types/tab';

export interface WhoPaidSheetProps {
    open: boolean;
    onClose: () => void;
    participants: TabParticipant[];
    /** The seat currently credited with fronting the bill. */
    payerId: number | null;
    /** The viewer's own seat, so it can read "You". */
    meId?: number | null;
    onSave: (payerId: number, venmoUsername?: string) => Promise<void>;
}

type WhoPaidFormProps = Omit<WhoPaidSheetProps, 'open'>;

/**
 * The picker itself, mounted only while the sheet is open.
 *
 * Split out so the draft is seeded from props exactly once, by the `useState`
 * initialisers below, and never again. Syncing it in an effect looked
 * equivalent and was not: the board re-reads the tab every few seconds, which
 * hands this a fresh `participants` array each time, so the effect re-ran and
 * put the selection back to whoever was already saved. You would pick somebody,
 * and a moment later it would silently snap back to you.
 *
 * `Sheet` renders nothing when closed, so this unmounts on close and gets its
 * initial state again on the next opening — which is all the re-seeding that
 * was ever wanted.
 */
const WhoPaidForm: React.FC<WhoPaidFormProps> = ({
    onClose,
    participants,
    payerId,
    meId,
    onSave,
}) => {
    const [selected, setSelected] = useState<number | null>(payerId);
    const [handle, setHandle] = useState(
        () => participants.find((p) => p.id === payerId)?.venmo_username ?? ''
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const seat = participants.find((p) => p.id === selected) ?? null;
    const needsHandle = Boolean(seat && seat.user_id === null);

    const pick = (participant: TabParticipant) => {
        setSelected(participant.id);
        setHandle(participant.venmo_username ?? '');
        setError(null);
    };

    const save = async () => {
        if (selected == null) return;

        const problem = needsHandle ? venmoUsernameError(handle) : null;
        if (problem) {
            setError(problem);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onSave(
                selected,
                needsHandle ? normalizeVenmoUsername(handle) : undefined
            );
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save that');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <p className="text-[12.5px] text-sw-muted">
                Whoever fronted the bill is who everyone else owes. It does not have
                to be you, and they do not need a Splitwiser account.
            </p>

            <div className="flex gap-[7px] flex-wrap">
                {participants.map((participant) => {
                    const isSelected = participant.id === selected;
                    return (
                        <button
                            key={participant.id}
                            type="button"
                            onClick={() => pick(participant)}
                            aria-pressed={isSelected}
                            className={`flex items-center gap-1.5 pl-1.5 pr-3 py-[7px] rounded-full text-[13px] focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 ${
                                isSelected
                                    ? 'bg-sw-accent-ghost text-sw-accent shadow-[0_0_0_1px_var(--sw-accent)]'
                                    : 'bg-sw-surface text-sw-muted shadow-[0_0_0_1px_var(--sw-line)]'
                            }`}
                        >
                            <Avatar
                                name={participant.display_name}
                                size={23}
                                variant={isSelected ? 'accent' : 'neutral'}
                            />
                            {participant.id === meId
                                ? 'You'
                                : participant.display_name}
                        </button>
                    );
                })}
            </div>

            {needsHandle && seat && (
                <Field
                    label={`${seat.display_name}'s Venmo`}
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="their-handle"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    hint={
                        <>
                            Optional. {seat.display_name} has no Splitwiser account,
                            so the claim page has no other way to send people to
                            them. Anyone holding this tab&rsquo;s link will see it.
                        </>
                    }
                />
            )}

            {seat && seat.user_id !== null && (
                <p className="text-[11.5px] text-sw-dim">
                    {seat.id === meId ? 'Your' : `${seat.display_name}'s`} Venmo
                    handle comes from {seat.id === meId ? 'your' : 'their'} account
                    settings.
                </p>
            )}

            {error && <Notice tone="error">{error}</Notice>}

            <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose} className="min-h-[42px]">
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    block
                    disabled={saving || selected == null}
                    onClick={save}
                    className="min-h-[42px]"
                >
                    {saving ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </div>
    );
};

/**
 * Who actually paid — including somebody who has never heard of Splitwiser.
 *
 * The person doing the arithmetic is not always the person who handed over a
 * card. When a friend with no account picks up the cheque, everybody owes
 * *them*, directly and outside the app, and the claim page needs to say so:
 * otherwise it hands every guest at the table a link to pay the organiser,
 * which is money going to the wrong person.
 *
 * A seat with no account has nowhere to keep a Venmo handle, so this collects
 * one. A seat with an account already carries theirs on their own profile, and
 * that is left alone — copying it here would fork it.
 */
const WhoPaidSheet: React.FC<WhoPaidSheetProps> = ({ open, ...rest }) => (
    <Sheet open={open} onClose={rest.onClose} label="Who paid" title="Who paid?">
        <WhoPaidForm {...rest} />
    </Sheet>
);

export default WhoPaidSheet;
