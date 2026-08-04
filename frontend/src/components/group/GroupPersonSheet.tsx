import React, { useEffect, useState } from 'react';
import { ArrowsMerge, Link, LinkBreak, Trash, UserPlus } from '@phosphor-icons/react';
import { Avatar, Button, Notice, Sheet } from '../ui';
import { api } from '../../services/api';
import { useAppData } from '../../contexts/AppDataContext';
import type { GroupMember, GuestMember } from '../../types/group';

/** Either kind of person in a group. Guests have no account behind them. */
export type GroupPerson =
    | { kind: 'member'; member: GroupMember }
    | { kind: 'guest'; guest: GuestMember };

export interface GroupPersonSheetProps {
    person: GroupPerson | null;
    onClose: () => void;
    groupId: number;
    members: GroupMember[];
    guests: GuestMember[];
    /** The viewer, so the sheet can refuse to act on them. */
    currentUserId?: number;
    /** Who created the group. Only they may merge a guest into someone else. */
    ownerId?: number;
    /** Refetch the group after anything changes. */
    onChanged: () => void;
}

type Feedback = { tone: 'success' | 'error'; message: string } | null;

function nameOf(person: GroupPerson): string {
    return person.kind === 'member'
        ? person.member.full_name
        : person.guest.name;
}

function managerNameOf(person: GroupPerson): string | null {
    return person.kind === 'member'
        ? person.member.managed_by_name
        : person.guest.managed_by_name;
}

/**
 * Everything you can do to one person in a group.
 *
 * The redesign turned the member list into chips, which had nowhere to hang
 * these actions — so they collect here, opened by pressing the chip. The set
 * is deliberately the same as the old app's two management modals plus the
 * guest claim and the friend request, which were separate screens each.
 */
const GroupPersonSheet: React.FC<GroupPersonSheetProps> = ({
    person,
    onClose,
    groupId,
    members,
    guests,
    currentUserId,
    ownerId,
    onChanged,
}) => {
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [busy, setBusy] = useState(false);
    const [confirmingRemove, setConfirmingRemove] = useState(false);
    // "user:12" / "guest:3" — the two id spaces overlap, so the kind travels
    // with the id.
    const [managerKey, setManagerKey] = useState('');
    // The account a guest is about to be folded onto, and the are-you-sure
    // step in front of it: a merge rewrites history and cannot be undone.
    const [mergeUserId, setMergeUserId] = useState('');
    const [confirmingMerge, setConfirmingMerge] = useState(false);
    // Read from the shell's copy rather than asking /friends/status per person:
    // the list is already loaded, and this only decides whether to show a row.
    const { friends } = useAppData();

    useEffect(() => {
        setFeedback(null);
        setConfirmingRemove(false);
        setManagerKey('');
        setMergeUserId('');
        setConfirmingMerge(false);
    }, [person]);

    if (!person) return null;

    const name = nameOf(person);
    const managedBy = managerNameOf(person);
    const isMe =
        person.kind === 'member' && person.member.user_id === currentUserId;
    const claimed =
        person.kind === 'guest' && person.guest.claimed_by_id !== null;
    const alreadyFriends =
        person.kind === 'member' &&
        friends.some((friend) => friend.id === person.member.user_id);

    /** Everyone who could absorb this person's balance — not themselves. */
    const candidates: { key: string; label: string }[] = [
        ...members
            .filter(
                (member) =>
                    !(person.kind === 'member' && member.id === person.member.id)
            )
            .map((member) => ({
                key: `user:${member.user_id}`,
                label:
                    member.user_id === currentUserId
                        ? `${member.full_name} (you)`
                        : member.full_name,
            })),
        ...guests
            .filter(
                (guest) =>
                    !(person.kind === 'guest' && guest.id === person.guest.id)
            )
            .map((guest) => ({
                key: `guest:${guest.id}`,
                label: `${guest.name} · guest`,
            })),
    ];

    const run = async (
        action: () => Promise<Response>,
        success: string,
        failure: string
    ) => {
        setBusy(true);
        setFeedback(null);
        try {
            const response = await action();
            if (response.ok) {
                setFeedback({ tone: 'success', message: success });
                onChanged();
            } else {
                const body = await response.json().catch(() => ({}));
                // 422 carries an array of field errors; everything else a string.
                const detail = Array.isArray(body.detail)
                    ? body.detail[0]?.msg
                    : body.detail;
                setFeedback({
                    tone: 'error',
                    message: typeof detail === 'string' ? detail : failure,
                });
            }
        } catch {
            setFeedback({ tone: 'error', message: failure });
        } finally {
            setBusy(false);
        }
    };

    const setManager = () => {
        if (!managerKey) {
            setFeedback({ tone: 'error', message: 'Pick who absorbs the balance.' });
            return;
        }
        const [kind, rawId] = managerKey.split(':');
        const id = Number(rawId);
        const managerIsGuest = kind === 'guest';

        run(
            () =>
                person.kind === 'guest'
                    ? api.groups.manageGuest(groupId, person.guest.id, id, managerIsGuest)
                    : api.groups.manageMember(
                          groupId,
                          person.member.user_id,
                          id,
                          managerIsGuest
                      ),
            'Balance linked.',
            'Could not link that balance.'
        );
    };

    const unlink = () =>
        run(
            () =>
                person.kind === 'guest'
                    ? api.groups.unmanageGuest(groupId, person.guest.id)
                    : api.groups.unmanageMember(groupId, person.member.user_id),
            'Back to their own balance.',
            'Could not unlink that balance.'
        );

    const remove = () =>
        run(
            () =>
                person.kind === 'guest'
                    ? api.groups.removeGuest(groupId, person.guest.id)
                    : api.groups.removeMember(groupId, person.member.user_id),
            `${name} removed from the group.`,
            `Could not remove ${name}.`
        );

    const claim = () =>
        run(
            () => api.groups.claimGuest(groupId, (person as { guest: GuestMember }).guest.id),
            'Claimed — their history is yours now.',
            'Could not claim that guest.'
        );

    const merge = () => {
        const targetId = Number(mergeUserId);
        const target = members.find((member) => member.user_id === targetId);
        setConfirmingMerge(false);
        run(
            () =>
                api.groups.mergeGuest(
                    groupId,
                    (person as { guest: GuestMember }).guest.id,
                    targetId
                ),
            `Merged into ${target?.full_name ?? 'their account'}.`,
            'Could not merge that guest.'
        );
    };

    const sendRequest = () =>
        run(
            () =>
                api.friends.sendRequest(
                    (person as { member: GroupMember }).member.user_id
                ),
            'Friend request sent.',
            'Could not send that request.'
        );

    const rowClass =
        'flex items-center gap-3 w-full px-3.5 py-3 rounded-sw-card bg-sw-surface shadow-[0_0_0_1px_var(--sw-line)] text-left text-sm hover:bg-sw-raise disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2';

    return (
        <Sheet
            open
            onClose={onClose}
            label={name}
            className="lg:max-w-[440px] lg:rounded-b-sw-sheet lg:mb-6"
        >
            <div className="flex items-center gap-3 px-1 pb-1">
                <Avatar name={name} size={38} variant={isMe ? 'accent' : 'neutral'} />
                <div className="min-w-0">
                    <div className="text-[15px] font-medium truncate">{name}</div>
                    <div className="text-[12px] text-sw-dim truncate">
                        {person.kind === 'guest'
                            ? claimed
                                ? 'Guest · claimed'
                                : 'Guest · no account'
                            : person.member.email}
                    </div>
                </div>
            </div>

            {feedback && <Notice tone={feedback.tone}>{feedback.message}</Notice>}

            {/* ------------------------------------------------ claiming */}
            {person.kind === 'guest' && !claimed && (
                <button
                    type="button"
                    onClick={claim}
                    disabled={busy}
                    className={rowClass}
                >
                    <UserPlus size={18} className="text-sw-muted flex-none" />
                    <span className="flex-1">
                        <span className="block">Claim this guest as me</span>
                        <span className="block text-[12px] text-sw-dim">
                            Moves everything they were in onto your account.
                        </span>
                    </span>
                </button>
            )}

            {/* --------------------------------------------------- merging */}
            {/*
              * The fix for a guest who signed up and joined as themselves
              * rather than claiming their seat, leaving the group holding two
              * of them. Only the owner sees it: everyone else can merge onto
              * their own account, which is the claim row above.
              */}
            {person.kind === 'guest' &&
                !claimed &&
                currentUserId !== undefined &&
                currentUserId === ownerId && (
                    <div className="flex flex-col gap-2 px-1 pt-1">
                        <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                            Merge into an account
                        </div>

                        {members.length === 0 ? (
                            <p className="text-[12.5px] text-sw-dim">
                                Nobody in this group has an account to merge into
                                yet.
                            </p>
                        ) : confirmingMerge ? (
                            <div className="flex flex-col gap-2 p-3 rounded-sw-card bg-sw-raise">
                                <p className="text-[12.5px] text-sw-muted">
                                    Move everything <strong>{name}</strong> was in
                                    onto{' '}
                                    <strong>
                                        {members.find(
                                            (member) =>
                                                member.user_id === Number(mergeUserId)
                                        )?.full_name ?? 'that account'}
                                    </strong>
                                    ? The guest stops appearing on their own. This
                                    cannot be undone.
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setConfirmingMerge(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        variant="primary"
                                        icon={<ArrowsMerge size={15} />}
                                        onClick={merge}
                                        disabled={busy}
                                    >
                                        Merge
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p className="text-[12.5px] text-sw-muted">
                                    If they joined with their own account instead of
                                    taking this seat, fold the guest's expenses and
                                    splits onto that account.
                                </p>
                                <div className="flex gap-2">
                                    <select
                                        value={mergeUserId}
                                        onChange={(event) =>
                                            setMergeUserId(event.target.value)
                                        }
                                        aria-label={`Which account is ${name}`}
                                        className="flex-1 min-w-0 px-3 py-2.5 rounded-sw-row bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                    >
                                        <option value="">Pick an account</option>
                                        {members.map((member) => (
                                            <option
                                                key={member.user_id}
                                                value={member.user_id}
                                            >
                                                {member.user_id === currentUserId
                                                    ? `${member.full_name} (you)`
                                                    : member.full_name}
                                            </option>
                                        ))}
                                    </select>
                                    <Button
                                        variant="primary"
                                        icon={<ArrowsMerge size={15} />}
                                        onClick={() => setConfirmingMerge(true)}
                                        disabled={busy || !mergeUserId}
                                    >
                                        Merge
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

            {/* ------------------------------------------ friend request */}
            {person.kind === 'member' && !isMe && !alreadyFriends && (
                <button
                    type="button"
                    onClick={sendRequest}
                    disabled={busy}
                    className={rowClass}
                >
                    <UserPlus size={18} className="text-sw-muted flex-none" />
                    <span className="flex-1">
                        <span className="block">Send a friend request</span>
                        <span className="block text-[12px] text-sw-dim">
                            So you can split with them outside this group.
                        </span>
                    </span>
                </button>
            )}

            {/* ------------------------------------- balance aggregation */}
            <div className="flex flex-col gap-2 px-1 pt-1">
                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim">
                    Balance
                </div>

                {managedBy ? (
                    <>
                        <p className="text-[12.5px] text-sw-muted">
                            Folded into <strong>{managedBy}</strong>, who settles up
                            for them. They still appear on their own expenses.
                        </p>
                        <Button
                            variant="secondary"
                            icon={<LinkBreak size={15} />}
                            onClick={unlink}
                            disabled={busy}
                            className="self-start"
                        >
                            Give them their own balance
                        </Button>
                    </>
                ) : candidates.length === 0 ? (
                    <p className="text-[12.5px] text-sw-dim">
                        Nobody else in the group to fold this balance into.
                    </p>
                ) : (
                    <>
                        <p className="text-[12.5px] text-sw-muted">
                            Fold what they owe into somebody else, who settles up on
                            their behalf.
                        </p>
                        <div className="flex gap-2">
                            <select
                                value={managerKey}
                                onChange={(event) => setManagerKey(event.target.value)}
                                aria-label={`Who settles up for ${name}`}
                                className="flex-1 min-w-0 px-3 py-2.5 rounded-sw-row bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                <option value="">Nobody — own balance</option>
                                {candidates.map((candidate) => (
                                    <option key={candidate.key} value={candidate.key}>
                                        {candidate.label}
                                    </option>
                                ))}
                            </select>
                            <Button
                                variant="primary"
                                icon={<Link size={15} />}
                                onClick={setManager}
                                disabled={busy || !managerKey}
                            >
                                Link
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* ------------------------------------------------- removal */}
            {!isMe && (
                <div className="pt-1">
                    {confirmingRemove ? (
                        <div className="flex flex-col gap-2 p-3 rounded-sw-card bg-sw-neg-soft">
                            <p className="text-[12.5px] text-sw-neg">
                                Remove {name} from this group? Their expenses stay,
                                so the group total does not move.
                            </p>
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    onClick={() => setConfirmingRemove(false)}
                                >
                                    Keep them
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={remove}
                                    disabled={busy}
                                    className="text-sw-neg border-sw-neg"
                                >
                                    Remove
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setConfirmingRemove(true)}
                            disabled={busy}
                            className={`${rowClass} text-sw-neg`}
                        >
                            <Trash size={18} className="flex-none" />
                            <span className="flex-1">Remove from this group</span>
                        </button>
                    )}
                </div>
            )}
        </Sheet>
    );
};

export default GroupPersonSheet;
