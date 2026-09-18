import React, { useEffect, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Button, Notice, Sheet } from './ui';
import { CONTROL_CLASS } from './ui/controlClass';
import PaymentAmountField from './PaymentAmountField';
import VenmoButton from './VenmoButton';
import { amountToCents } from '../utils/amountInput';
import { buildVenmoLinks, venmoUnavailableNote } from '../utils/venmo';
import type { PaymentParty } from '../utils/settleAmount';

/** Somebody who can be a side of a payment: a member or a guest of a group. */
export interface PaymentPerson extends PaymentParty {
    name: string;
    /** Only a registered account can have one. */
    venmoUsername?: string | null;
}

interface OffPlanGroup {
    id: number;
    name: string;
    currency: string;
}

export interface OffPlanPayment {
    groupId: number;
    currency: string;
    payer: PaymentPerson;
    payee: PaymentPerson;
    cents: number;
}

export interface OffPlanPaymentSheetProps {
    /** Groups the payment can be recorded in. One means no picker. */
    groups: OffPlanGroup[];
    /** Everyone in a group, loaded when it is picked. */
    loadPeople: (groupId: number) => Promise<PaymentPerson[]>;
    /** The signed-in user, so the pickers can say "You" and default the payer. */
    youId: number;
    onClose: () => void;
    onRecord: (payment: OffPlanPayment) => void;
    busy?: boolean;
    error?: string | null;
}

const personKey = (p: PaymentParty) => `${p.isGuest ? 'g' : 'u'}${p.userId}`;

/**
 * Recording a payment the plan never suggested.
 *
 * The plan is the *fewest* transfers that clear the group, and people do not
 * always follow it: Maya was told to pay Sam, but she owed Dev a favour and
 * paid Dev instead. That is a real payment and the ledger should hold it.
 * The group's balances move by exactly what changed hands and the plan
 * re-works around it — which is the one case where the plan legitimately
 * changes, as `docs/FEATURES.md` sets out.
 *
 * Both sides are pickable rather than only "who you paid", because the group
 * modal already lets a member record a payment between two other people, and
 * one sheet serving both surfaces is better than two that drift. The payer
 * defaults to the signed-in user, which is the common case everywhere.
 *
 * Mount this only while it is open: the group and the people are seeded at
 * mount.
 */
const OffPlanPaymentSheet: React.FC<OffPlanPaymentSheetProps> = ({
    groups,
    loadPeople,
    youId,
    onClose,
    onRecord,
    busy = false,
    error = null,
}) => {
    const [groupId, setGroupId] = useState<number>(groups[0]?.id ?? 0);
    /**
     * The roster, tagged with the group it belongs to. Ids repeat across
     * groups (guests especially), so a roster is only ever read against the
     * group it was loaded for — switching groups blanks it until the new one
     * lands, without an effect having to clear anything.
     */
    const [roster, setRoster] = useState<
        { groupId: number; people: PaymentPerson[] } | { groupId: number; failed: true } | null
    >(null);
    const [payerKey, setPayerKey] = useState(`u${youId}`);
    const [payeeKey, setPayeeKey] = useState<string>('');
    const [entry, setEntry] = useState('');

    const group = groups.find((g) => g.id === groupId) ?? null;
    const current = roster?.groupId === groupId ? roster : null;
    const people = current && 'people' in current ? current.people : null;
    const loadFailed = current !== null && 'failed' in current;

    useEffect(() => {
        let cancelled = false;
        loadPeople(groupId)
            .then((loaded) => {
                if (cancelled) return;
                setRoster({ groupId, people: loaded });
                // Keep "you" as the payer where possible, and pick the first
                // other person as the payee so the form is one field from done.
                const you = loaded.find((p) => !p.isGuest && p.userId === youId);
                const payer = you ?? loaded[0];
                const payee = loaded.find((p) => payer && personKey(p) !== personKey(payer));
                setPayerKey(payer ? personKey(payer) : '');
                setPayeeKey(payee ? personKey(payee) : '');
            })
            .catch(() => {
                if (!cancelled) setRoster({ groupId, failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [groupId, loadPeople, youId]);

    const byKey = (key: string) => people?.find((p) => personKey(p) === key) ?? null;
    const payer = byKey(payerKey);
    const payee = byKey(payeeKey);
    const samePerson = payer !== null && payee !== null && personKey(payer) === personKey(payee);

    const cents = amountToCents(entry);
    const ready = group !== null && payer !== null && payee !== null && !samePerson && cents !== null;

    /** "You" when it is the signed-in user, so the pickers read as a sentence. */
    const label = (p: PaymentPerson) => (!p.isGuest && p.userId === youId ? 'You' : p.name);

    /**
     * The hand-off, only when the signed-in user is the one paying: it is
     * their Venmo that opens, and charging somebody else's debt is not theirs
     * to do.
     */
    const iPay = payer !== null && !payer.isGuest && payer.userId === youId;
    const venmo =
        iPay && group && payee?.venmoUsername && cents && !samePerson
            ? buildVenmoLinks({
                  username: payee.venmoUsername,
                  amountCents: cents,
                  currency: group.currency,
                  action: 'pay',
                  note: `Settling up: ${group.name}`,
              })
            : null;
    const venmoMissing =
        iPay && group && payee?.venmoUsername && cents && !samePerson && !venmo
            ? venmoUnavailableNote(group.currency)
            : null;

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!ready || busy) return;
        onRecord({ groupId: group.id, currency: group.currency, payer, payee, cents });
    };

    const picker = (
        id: string,
        title: string,
        value: string,
        onChange: (key: string) => void
    ) => (
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <label htmlFor={id} className="text-[12.5px] text-sw-muted">
                {title}
            </label>
            <select
                id={id}
                className={CONTROL_CLASS}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={people === null}
            >
                {(people ?? []).map((p) => (
                    <option key={personKey(p)} value={personKey(p)}>
                        {label(p)}
                    </option>
                ))}
            </select>
        </div>
    );

    return (
        <Sheet
            open
            onClose={onClose}
            label="Record another payment"
            title="Record another payment"
            className="lg:max-w-[420px] lg:rounded-b-sw-sheet lg:mb-6"
        >
            <form onSubmit={submit} className="flex flex-col gap-3.5">
                {groups.length > 1 && (
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="offplan-group" className="text-[12.5px] text-sw-muted">
                            Group
                        </label>
                        <select
                            id="offplan-group"
                            className={CONTROL_CLASS}
                            value={groupId}
                            onChange={(event) => setGroupId(parseInt(event.target.value, 10))}
                        >
                            {groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                    {g.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="flex gap-2">
                    {picker('offplan-payer', 'Paid by', payerKey, setPayerKey)}
                    {picker('offplan-payee', 'Paid to', payeeKey, setPayeeKey)}
                </div>

                {loadFailed && (
                    <Notice tone="error">Could not load who is in this group.</Notice>
                )}

                <div className="flex flex-col gap-1.5">
                    <PaymentAmountField
                        value={entry}
                        onChange={setEntry}
                        currency={group?.currency ?? ''}
                    />
                    <p className="text-[11.5px] text-sw-dim min-h-[1.25em]">
                        {samePerson
                            ? 'Pick two different people.'
                            : 'Not one of the suggested payments. Balances move by this much and the plan re-works around it.'}
                    </p>
                </div>

                {error && <Notice tone="error">{error}</Notice>}

                <div className="flex gap-2">
                    {venmo && payee && (
                        <VenmoButton
                            links={venmo}
                            action="pay"
                            counterparty={payee.name}
                            className="min-h-[46px] flex-1"
                        />
                    )}
                    <Button
                        type="submit"
                        variant="primary"
                        block={!venmo}
                        icon={<Check size={15} />}
                        disabled={!ready || busy}
                        className="min-h-[46px] flex-1"
                    >
                        {busy ? 'Recording…' : 'Record'}
                    </Button>
                </div>

                {venmo && (
                    <p className="text-[11.5px] text-sw-dim">
                        Venmo opens with this amount filled in. Recording is what
                        changes the balance here.
                    </p>
                )}
                {venmoMissing && (
                    <p className="text-[11.5px] text-sw-dim">{venmoMissing}</p>
                )}
            </form>
        </Sheet>
    );
};

export default OffPlanPaymentSheet;
